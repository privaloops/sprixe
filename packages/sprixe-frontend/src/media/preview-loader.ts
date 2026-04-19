/**
 * PreviewLoader — lazy-fetch + cache screenshots and MP4 clips for
 * the video preview panel (§3.10).
 *
 * Strategy per §3.10 Option A: no manifest. Try to fetch each asset
 * and treat 404 as "this game doesn't have one". Successfully-fetched
 * blobs land in MediaCache keyed by `media:${gameId}:${kind}` so
 * subsequent selections hit cache.
 *
 * Video URLs are returned as strings so the consumer can set them on
 * a <video src="..."> directly — browsers stream videos more
 * efficiently than blob: URLs.
 */

import type { System } from "../data/games";
import type { MediaCache } from "./media-cache";
import { fetchArcadeDbAsset, arcadeDbUrl, type ArcadeDbKind } from "./fetchers/arcadedb";
import { generateMarquee } from "./fetchers/generated-marquee";

export type AssetKind = "screenshot" | "video" | "marquee";

export interface PreviewLoaderOptions {
  cache: MediaCache;
  /**
   * CDN base URL without trailing slash, e.g. https://cdn.sprixe.app/media.
   * Used as the first (preferred) source when non-empty — it lets
   * operators self-host curated assets that override the community
   * set. In dev we leave it pointing at the local /media/ path which
   * 404s everywhere; that's fine, the cascade silently falls through.
   */
  cdnBase: string;
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
  /**
   * Override the ArcadeDB fetcher — mainly for unit tests that don't
   * want to hit the live server. Receives the ArcadeDB kind
   * (ingames / marquees / videos) and the game id, returns a Blob or
   * null.
   */
  arcadeDbImpl?: (kind: ArcadeDbKind, gameId: string) => Promise<Blob | null>;
  /** Override the fallback marquee generator. */
  marqueeGenImpl?: (title: string) => Promise<Blob | null>;
}

export class PreviewLoader {
  private readonly cache: MediaCache;
  private readonly cdnBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly arcadeDbImpl: (kind: ArcadeDbKind, gameId: string) => Promise<Blob | null>;
  private readonly marqueeGenImpl: (title: string) => Promise<Blob | null>;

  constructor(options: PreviewLoaderOptions) {
    this.cache = options.cache;
    this.cdnBase = options.cdnBase.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.arcadeDbImpl = options.arcadeDbImpl
      ?? ((kind, id) => fetchArcadeDbAsset(kind, id, this.fetchImpl));
    this.marqueeGenImpl = options.marqueeGenImpl ?? generateMarquee;
  }

  screenshotUrl(gameId: string, system: System): string {
    return `${this.cdnBase}/${system}/${gameId}/screenshot.png`;
  }

  /**
   * URL to stream the gameplay video from. Prefers the operator's CDN
   * when it serves one, falls back to ArcadeDB — which is the pattern
   * Recalbox / Batocera use by default. The caller (VideoPreview)
   * mounts a `<video src>` directly so the browser streams it rather
   * than buffering through a blob URL.
   */
  videoUrl(gameId: string, _system: System): string {
    // VideoPreview picks a URL via hasVideo() today; it doesn't call
    // this helper. Kept for API parity + tests.
    return arcadeDbUrl("videos", gameId);
  }

  marqueeUrl(gameId: string, system: System): string {
    return `${this.cdnBase}/${system}/${gameId}/marquee.png`;
  }

  cacheKey(gameId: string, kind: AssetKind): string {
    return `media:${gameId}:${kind}`;
  }

  /**
   * Screenshot cascade: operator CDN → ArcadeDB `ingames` → null
   * (consumer shows the built-in SVG placeholder). Returns the first
   * source that succeeds; caches the blob so repeated hovers never
   * re-fetch.
   */
  async loadScreenshot(gameId: string, system: System): Promise<Blob | null> {
    const key = this.cacheKey(gameId, "screenshot");
    const cached = await this.cache.get(key);
    if (cached) return cached;

    // 1. Operator-curated CDN (override priority).
    const cdn = await this.tryFetch(this.screenshotUrl(gameId, system));
    if (cdn) return this.putCache(key, cdn);

    // 2. ArcadeDB — Motoschifo's CC0 dataset, also Recalbox's default.
    const arcadedb = await this.arcadeDbImpl("ingames", gameId);
    if (arcadedb) return this.putCache(key, arcadedb);

    return null;
  }

  /**
   * Marquee cascade: operator CDN → ArcadeDB `marquees` → canvas
   * generated fallback. The final stage always yields a blob so the
   * browser panel never shows an empty band.
   */
  async loadMarquee(gameId: string, system: System, gameTitle: string): Promise<Blob | null> {
    const key = this.cacheKey(gameId, "marquee");
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const cdn = await this.tryFetch(this.marqueeUrl(gameId, system));
    if (cdn) return this.putCache(key, cdn);

    const arcadedb = await this.arcadeDbImpl("marquees", gameId);
    if (arcadedb) return this.putCache(key, arcadedb);

    const generated = await this.marqueeGenImpl(gameTitle);
    if (generated) return this.putCache(key, generated);
    return null;
  }

  /**
   * HEAD-probe ArcadeDB for a gameplay video; returns true when the
   * consumer should mount a `<video src={videoUrl()}>` and let the
   * browser stream directly. Future operator CDN overrides take
   * priority when configured.
   */
  async hasVideo(gameId: string, _system: System): Promise<boolean> {
    try {
      const response = await this.fetchImpl(arcadeDbUrl("videos", gameId), { method: "HEAD" });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async tryFetch(url: string): Promise<Blob | null> {
    try {
      const response = await this.fetchImpl(url);
      if (!response.ok) return null;
      return await response.blob();
    } catch {
      return null;
    }
  }

  private async putCache(key: string, blob: Blob): Promise<Blob> {
    try { await this.cache.put(key, blob); } catch { /* best-effort */ }
    return blob;
  }
}

/**
 * Schedule the video-preview crossfade: after `delayMs` of continuous
 * hover on the same game, fire the callback so the consumer can set
 * the <video> src + start playback. Returns a cancel handle that the
 * consumer invokes on selection change / unmount.
 */
export function scheduleVideoFade(
  delayMs: number,
  cb: () => void,
  timer: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  }
): () => void {
  const id = timer.setTimeout(cb, delayMs);
  return () => timer.clearTimeout(id);
}

export const DEFAULT_CROSSFADE_DELAY_MS = 1000;
