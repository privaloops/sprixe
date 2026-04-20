/**
 * PreviewLoader — exposes the cascade of asset URLs for a game card.
 *
 * The network layer is deliberately thin: we no longer `fetch()` +
 * Blob for remote assets because third-party servers like ArcadeDB
 * don't serve CORS headers, which the browser enforces for fetch but
 * NOT for `<img src>` / `<video src>`. Consumers set the returned
 * URLs directly on DOM elements and cascade via `onerror`.
 *
 * Cache strategy:
 *   - External URLs: browser HTTP cache does the job.
 *   - Generated marquee: kept in MediaCache (IDB) as a data URL since
 *     re-painting the same canvas on every hover is wasteful.
 *
 * Cascade per asset kind:
 *   screenshot: operator CDN → ArcadeDB `ingames` → null
 *   marquee:    operator CDN → ArcadeDB `marquees` → generated (local)
 *   video:      operator CDN → ArcadeDB `videos`   → no video
 *
 * `cdnBase` lets an operator override both ArcadeDB and the generator
 * by self-hosting /media/{system}/{id}/{screenshot|marquee|video}.
 */

import type { System } from "../data/games";
import type { MediaCache } from "./media-cache";
import { arcadeDbUrl, arcadeDbVideoSdUrl } from "./fetchers/arcadedb";
import { generateMarquee } from "./fetchers/generated-marquee";
import { trimVideoBlob } from "./trim-video";

const ARCADEDB_ORIGIN = "https://adb.arcadeitalia.net";
const ARCADEDB_PROXY_PATH = "/arcadedb";

/** Default LRU cap for the video cache portion. */
export const DEFAULT_VIDEO_CACHE_BYTES = 500 * 1024 * 1024;
/** Default clip length kept in the cache (seconds). */
export const DEFAULT_VIDEO_CLIP_SECONDS = 5;

function toProxiedUrl(url: string): string {
  if (url.startsWith(ARCADEDB_ORIGIN)) {
    return ARCADEDB_PROXY_PATH + url.slice(ARCADEDB_ORIGIN.length);
  }
  return url;
}

export type AssetKind = "screenshot" | "video" | "marquee";

export interface PreviewLoaderOptions {
  cache: MediaCache;
  /**
   * Optional operator CDN base URL (no trailing slash). When set, its
   * `/{system}/{id}/{screenshot|marquee|video}` asset takes priority
   * over ArcadeDB. Leave undefined / empty in dev so we don't spam
   * the console with 404s for assets nobody ever published.
   */
  cdnBase?: string;
  /** Override the marquee canvas generator (unit tests). */
  marqueeGenImpl?: (title: string) => Promise<Blob | null>;
  /** LRU byte cap for the cache, enforced after each video prime. */
  videoCacheBytes?: number;
  /** Seconds of each source video kept in the cache. Defaults to 5. */
  videoClipSeconds?: number;
  /** Override the trim step (unit tests). */
  trimVideoImpl?: (source: Blob, seconds: number) => Promise<Blob | null>;
}

export class PreviewLoader {
  private readonly cache: MediaCache;
  private readonly cdnBase: string;
  private readonly marqueeGenImpl: (title: string) => Promise<Blob | null>;
  private readonly videoCacheBytes: number;
  private readonly videoClipSeconds: number;
  private readonly trimVideoImpl: (source: Blob, seconds: number) => Promise<Blob | null>;
  private readonly videoPrimeInflight = new Map<string, Promise<boolean>>();

  constructor(options: PreviewLoaderOptions) {
    this.cache = options.cache;
    this.cdnBase = (options.cdnBase ?? "").replace(/\/$/, "");
    this.marqueeGenImpl = options.marqueeGenImpl ?? generateMarquee;
    this.videoCacheBytes = options.videoCacheBytes ?? DEFAULT_VIDEO_CACHE_BYTES;
    this.videoClipSeconds = options.videoClipSeconds ?? DEFAULT_VIDEO_CLIP_SECONDS;
    this.trimVideoImpl = options.trimVideoImpl ?? ((blob, seconds) => trimVideoBlob(blob, { seconds }));
  }

  // ── URL builders ────────────────────────────────────────────────

  /** Empty string when no operator CDN is configured. */
  screenshotUrl(gameId: string, system: System): string {
    return this.cdnBase ? `${this.cdnBase}/${system}/${gameId}/screenshot.png` : "";
  }

  marqueeUrl(gameId: string, system: System): string {
    return this.cdnBase ? `${this.cdnBase}/${system}/${gameId}/marquee.png` : "";
  }

  videoUrl(gameId: string, system: System): string {
    return this.cdnBase ? `${this.cdnBase}/${system}/${gameId}/video.mp4` : "";
  }

  cacheKey(gameId: string, kind: AssetKind): string {
    return `media:${gameId}:${kind}`;
  }

  /**
   * Fetch the first reachable URL from `candidates`, cache the bytes in
   * IndexedDB, and return a blob: URL. On repeat calls the cached blob
   * is returned without hitting the network — critical when ArcadeDB
   * goes dark. URLs pointing at adb.arcadeitalia.net are rewritten
   * through the same-origin `/arcadedb` proxy so fetch can read the
   * body (cross-origin fetch without CORS would fail opaque).
   *
   * Returns null when every candidate failed and nothing was cached.
   */
  async getCachedOrFetchImage(cacheKey: string, candidates: string[]): Promise<string | null> {
    const cached = await this.cache.get(cacheKey).catch(() => null);
    if (cached && cached.size > 0) return URL.createObjectURL(cached);
    const blob = await this.fetchIntoCache(cacheKey, candidates);
    return blob ? URL.createObjectURL(blob) : null;
  }

  /**
   * Same cascade as `getCachedOrFetchImage`, but doesn't mint an object
   * URL — intended for the background scraper that only cares about
   * populating the cache. Returns `true` when the key is (now) cached.
   */
  async primeImageCache(cacheKey: string, candidates: string[]): Promise<boolean> {
    const cached = await this.cache.get(cacheKey).catch(() => null);
    if (cached && cached.size > 0) return true;
    const blob = await this.fetchIntoCache(cacheKey, candidates);
    return blob !== null;
  }

  private async fetchIntoCache(cacheKey: string, candidates: string[]): Promise<Blob | null> {
    for (const url of candidates) {
      const target = toProxiedUrl(url);
      try {
        const resp = await fetch(target);
        if (!resp.ok) continue;
        const blob = await resp.blob();
        if (blob.size === 0) continue;
        try { await this.cache.put(cacheKey, blob); } catch { /* quota */ }
        return blob;
      } catch {
        continue;
      }
    }
    return null;
  }

  // ── Cascades ────────────────────────────────────────────────────

  /** Ordered URLs the consumer should try (onerror → next). Operator CDN skipped when unset. */
  screenshotCandidates(gameId: string, system: System): string[] {
    return this.withCdn(this.screenshotUrl(gameId, system), arcadeDbUrl("ingames", gameId));
  }

  marqueeCandidates(gameId: string, system: System): string[] {
    return this.withCdn(this.marqueeUrl(gameId, system), arcadeDbUrl("marquees", gameId));
  }

  /**
   * Video cascade: operator CDN → ArcadeDB HD shortplay →
   * ArcadeDB SD shortplay → nothing. ArcadeDB bundles its MP4s
   * through `download_file.php`, so we hit that endpoint rather
   * than the plain `/media/.../videos/*.mp4` path (which 404s).
   */
  videoCandidates(gameId: string, system: System): string[] {
    const cdn = this.videoUrl(gameId, system);
    const hd = arcadeDbUrl("videos", gameId);
    const sd = arcadeDbVideoSdUrl(gameId);
    return cdn ? [cdn, hd, sd] : [hd, sd];
  }

  private withCdn(cdnUrl: string, arcadeDbUrl: string): string[] {
    return cdnUrl ? [cdnUrl, arcadeDbUrl] : [arcadeDbUrl];
  }

  /**
   * Return a blob: URL for the cached video clip, or null if nothing
   * is cached yet. Consumers that want to populate the cache must call
   * `primeVideoCache` in the background.
   */
  async getCachedVideoUrl(cacheKey: string): Promise<string | null> {
    const cached = await this.cache.get(cacheKey).catch(() => null);
    if (!cached || cached.size === 0) return null;
    return URL.createObjectURL(cached);
  }

  /**
   * Background-fetch the first reachable candidate, trim it to
   * `videoClipSeconds`, store the clip in the cache, then enforce
   * LRU eviction against `videoCacheBytes`. Repeat calls for the same
   * key dedupe via the inflight map. Returns `true` once the key is
   * (now) cached.
   */
  async primeVideoCache(cacheKey: string, candidates: string[]): Promise<boolean> {
    const cached = await this.cache.get(cacheKey).catch(() => null);
    if (cached && cached.size > 0) return true;
    const inflight = this.videoPrimeInflight.get(cacheKey);
    if (inflight) return inflight;
    const task = this.fetchTrimAndCacheVideo(cacheKey, candidates).finally(() => {
      this.videoPrimeInflight.delete(cacheKey);
    });
    this.videoPrimeInflight.set(cacheKey, task);
    return task;
  }

  private async fetchTrimAndCacheVideo(cacheKey: string, candidates: string[]): Promise<boolean> {
    for (const url of candidates) {
      const target = toProxiedUrl(url);
      let fullBlob: Blob;
      try {
        const resp = await fetch(target);
        if (!resp.ok) continue;
        fullBlob = await resp.blob();
        if (fullBlob.size === 0) continue;
      } catch {
        continue;
      }
      let clip: Blob;
      try {
        const trimmed = await this.trimVideoImpl(fullBlob, this.videoClipSeconds);
        clip = trimmed ?? fullBlob;
      } catch {
        clip = fullBlob;
      }
      try {
        await this.cache.put(cacheKey, clip);
      } catch {
        return false;
      }
      try {
        await this.cache.evictUntilUnder(this.videoCacheBytes);
      } catch { /* eviction best-effort */ }
      return true;
    }
    return false;
  }

  /**
   * Last-ditch marquee — paint the title on a canvas, cache the
   * resulting data URL in IDB so the expensive draw only happens
   * once per title-per-session. Returns null when neither the
   * generator nor the canvas API is available (jsdom).
   */
  async generateMarqueeUrl(gameId: string, gameTitle: string): Promise<string | null> {
    const key = this.cacheKey(gameId, "marquee");
    const cached = await this.cache.get(key);
    if (cached) return URL.createObjectURL(cached);

    const blob = await this.marqueeGenImpl(gameTitle);
    if (!blob) return null;
    try { await this.cache.put(key, blob); } catch { /* best-effort */ }
    return URL.createObjectURL(blob);
  }
}

export const DEFAULT_CROSSFADE_DELAY_MS = 1000;

/**
 * Schedule the video-preview crossfade: after `delayMs` of continuous
 * hover on the same game, fire the callback. Returns a cancel handle
 * that the consumer invokes on selection change / unmount.
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
