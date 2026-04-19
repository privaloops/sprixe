/**
 * VideoPreview — right-hand panel of the game browser (§2.4 + Phase 4b.2).
 *
 * With a PreviewLoader injected, selecting a new game:
 *   1. Immediately shows the GameEntry.screenshotUrl placeholder (fast).
 *   2. Async-fetches a CDN screenshot via loader.loadScreenshot(); when
 *      it resolves, upgrades the <img> src to the blob URL.
 *   3. After `crossfadeMs` (default 1000 ms) on the same game, mounts
 *      a <video> that streams the MP4 clip from the CDN if one exists
 *      (hasVideo HEAD probe). If hasVideo fails, the screenshot stays.
 *
 * Without a loader — backwards-compatible — the component behaves
 * exactly like Phase 1 (GameEntry.screenshotUrl → <img> src, no video).
 */

import type { GameEntry } from "../../data/games";
import { DEFAULT_CROSSFADE_DELAY_MS, type PreviewLoader } from "../../media/preview-loader";

export interface VideoPreviewOptions {
  loader?: PreviewLoader;
  /** Defaults to DEFAULT_CROSSFADE_DELAY_MS (1000 ms). */
  crossfadeMs?: number;
  /** Override timers for tests. */
  setTimer?: (cb: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
}

export class VideoPreview {
  readonly root: HTMLDivElement;

  private readonly imgEl: HTMLImageElement;
  private readonly marqueeEl: HTMLImageElement;
  private readonly titleEl: HTMLDivElement;
  private readonly metaEl: HTMLDivElement;
  private readonly favoriteEl: HTMLDivElement;
  private readonly media: HTMLDivElement;

  private readonly loader: PreviewLoader | undefined;
  private readonly crossfadeMs: number;
  private readonly setTimer: (cb: () => void, ms: number) => number;
  private readonly clearTimer: (id: number) => void;

  private currentId: string | null = null;
  private currentBlobUrl: string | null = null;
  private currentMarqueeBlobUrl: string | null = null;
  private currentVideoEl: HTMLVideoElement | null = null;
  private fadeTimerId: number | null = null;
  private pendingFetchToken = 0;

  constructor(container: HTMLElement, options: VideoPreviewOptions = {}) {
    this.loader = options.loader;
    this.crossfadeMs = options.crossfadeMs ?? DEFAULT_CROSSFADE_DELAY_MS;
    this.setTimer = options.setTimer ?? ((cb, ms) => window.setTimeout(cb, ms) as unknown as number);
    this.clearTimer = options.clearTimer ?? ((id) => window.clearTimeout(id));

    this.root = document.createElement("div");
    this.root.className = "af-video-preview";
    this.root.setAttribute("data-testid", "video-preview");

    // Marquee banner sits on top of the media block — gives each
    // game a "cabinet header" feel. Resolved via PreviewLoader's
    // CDN → libretro title → canvas-generated cascade.
    this.marqueeEl = document.createElement("img");
    this.marqueeEl.className = "af-video-preview-marquee";
    this.marqueeEl.setAttribute("data-testid", "video-preview-marquee");
    this.marqueeEl.alt = "";
    this.root.appendChild(this.marqueeEl);

    this.media = document.createElement("div");
    this.media.className = "af-video-preview-media";
    this.imgEl = document.createElement("img");
    this.imgEl.className = "af-video-preview-image";
    this.imgEl.setAttribute("data-testid", "video-preview-image");
    this.imgEl.alt = "";
    this.media.appendChild(this.imgEl);
    this.root.appendChild(this.media);

    const caption = document.createElement("div");
    caption.className = "af-video-preview-caption";
    this.titleEl = document.createElement("div");
    this.titleEl.className = "af-video-preview-title";
    caption.appendChild(this.titleEl);
    this.metaEl = document.createElement("div");
    this.metaEl.className = "af-video-preview-meta";
    caption.appendChild(this.metaEl);
    this.favoriteEl = document.createElement("div");
    this.favoriteEl.className = "af-video-preview-favorite";
    caption.appendChild(this.favoriteEl);
    this.root.appendChild(caption);

    container.appendChild(this.root);
  }

  setGame(game: GameEntry | null): void {
    // Cancel any pending crossfade or async fetch on every selection change.
    this.cancelFade();
    this.pendingFetchToken += 1;

    if (!game) {
      this.root.setAttribute("data-empty", "true");
      this.detachVideo();
      this.imgEl.removeAttribute("src");
      this.marqueeEl.removeAttribute("src");
      this.revokeBlobUrl();
      this.revokeMarqueeBlobUrl();
      this.titleEl.textContent = "";
      this.metaEl.textContent = "";
      this.favoriteEl.textContent = "";
      this.currentId = null;
      return;
    }

    this.root.removeAttribute("data-empty");
    if (this.currentId === game.id) return;
    this.currentId = game.id;

    // Immediate placeholder from the game metadata.
    this.detachVideo();
    this.setImageSrc(game.screenshotUrl, `${game.title} screenshot`);
    this.marqueeEl.removeAttribute("src");
    this.revokeMarqueeBlobUrl();
    this.titleEl.textContent = game.title;
    const systemLabel = game.system === "cps1" ? "CPS-1" : "Neo-Geo";
    this.metaEl.textContent = `${game.publisher} · ${game.year} · ${systemLabel}`;
    this.favoriteEl.textContent = game.favorite ? "★ Favorite" : "";

    // With a loader, resolve marquee + CDN screenshot asynchronously
    // and schedule the eventual crossfade to video. Each fetch is
    // guarded by the token so a fast succession of hovers never races
    // stale blobs onto the current selection.
    if (this.loader) {
      const token = this.pendingFetchToken;

      void this.loader.loadMarquee(game.id, game.system, game.title).then((blob) => {
        if (token !== this.pendingFetchToken) return;
        if (blob) this.applyMarquee(blob, `${game.title} marquee`);
      });

      void this.loader.loadScreenshot(game.id, game.system).then((blob) => {
        if (token !== this.pendingFetchToken) return;
        if (blob) this.applyCdnScreenshot(blob, `${game.title} screenshot`);
      });

      this.fadeTimerId = this.setTimer(() => {
        if (token !== this.pendingFetchToken) return;
        void this.tryMountVideo(game);
      }, this.crossfadeMs);
    }
  }

  /** Testing helper — the <video> element if one is currently mounted. */
  getVideoElement(): HTMLVideoElement | null {
    return this.currentVideoEl;
  }

  private async tryMountVideo(game: GameEntry): Promise<void> {
    if (!this.loader) return;
    let available = false;
    try {
      available = await this.loader.hasVideo(game.id, game.system);
    } catch {
      return;
    }
    if (!available || game.id !== this.currentId) return;

    const video = document.createElement("video");
    video.className = "af-video-preview-video";
    video.setAttribute("data-testid", "video-preview-video");
    video.setAttribute("playsinline", "true");
    video.muted = true;
    video.loop = true;
    video.src = this.loader.videoUrl(game.id, game.system);
    this.media.appendChild(video);
    try { await video.play(); } catch { /* autoplay blocked — leave visible anyway */ }
    this.currentVideoEl = video;
  }

  private detachVideo(): void {
    if (this.currentVideoEl) {
      try { this.currentVideoEl.pause(); } catch { /* ignore */ }
      this.currentVideoEl.remove();
      this.currentVideoEl = null;
    }
  }

  private setImageSrc(url: string | null, alt: string): void {
    this.revokeBlobUrl();
    if (url) {
      this.imgEl.src = url;
      this.imgEl.alt = alt;
    } else {
      this.imgEl.removeAttribute("src");
      this.imgEl.alt = "";
    }
  }

  private applyCdnScreenshot(blob: Blob, alt: string): void {
    this.revokeBlobUrl();
    const url = URL.createObjectURL(blob);
    this.currentBlobUrl = url;
    this.imgEl.src = url;
    this.imgEl.alt = alt;
  }

  private applyMarquee(blob: Blob, alt: string): void {
    this.revokeMarqueeBlobUrl();
    const url = URL.createObjectURL(blob);
    this.currentMarqueeBlobUrl = url;
    this.marqueeEl.src = url;
    this.marqueeEl.alt = alt;
  }

  private revokeBlobUrl(): void {
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }
  }

  private revokeMarqueeBlobUrl(): void {
    if (this.currentMarqueeBlobUrl) {
      URL.revokeObjectURL(this.currentMarqueeBlobUrl);
      this.currentMarqueeBlobUrl = null;
    }
  }

  private cancelFade(): void {
    if (this.fadeTimerId !== null) {
      this.clearTimer(this.fadeTimerId);
      this.fadeTimerId = null;
    }
  }
}
