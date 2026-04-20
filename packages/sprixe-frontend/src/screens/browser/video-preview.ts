/**
 * VideoPreview — media pane: screenshot upgraded to MP4 after a brief
 * hover delay. Marquee + caption live in BrowserScreen now.
 *
 * With a PreviewLoader injected, selecting a new game:
 *   1. Starts a <img> cascade through PreviewLoader.screenshotCandidates.
 *      Falls back to GameEntry.screenshotUrl if every remote URL 404s.
 *   2. After `crossfadeMs` (default 1000 ms) on the same game, mounts
 *      a <video> that streams the MP4 clip from the cascade if one
 *      exists. On repeated errors the screenshot stays visible.
 *
 * Without a loader — backwards-compatible test path — the component
 * just drops GameEntry.screenshotUrl into the <img>.
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
  private readonly loader: PreviewLoader | undefined;
  private readonly crossfadeMs: number;
  private readonly setTimer: (cb: () => void, ms: number) => number;
  private readonly clearTimer: (id: number) => void;

  private currentId: string | null = null;
  private currentVideoEl: HTMLVideoElement | null = null;
  private fadeTimerId: number | null = null;
  /** True once a preview has successfully auto-played with sound in
   * this page session. Sticky: once we know the autoplay policy lets
   * us play unmuted, subsequent wheel moves skip the mute fallback
   * so the sound stays on when the user cycles through games. */
  private static audioUnlocked = false;
  private pendingFetchToken = 0;

  constructor(container: HTMLElement, options: VideoPreviewOptions = {}) {
    this.loader = options.loader;
    this.crossfadeMs = options.crossfadeMs ?? DEFAULT_CROSSFADE_DELAY_MS;
    this.setTimer = options.setTimer ?? ((cb, ms) => window.setTimeout(cb, ms) as unknown as number);
    this.clearTimer = options.clearTimer ?? ((id) => window.clearTimeout(id));

    this.root = document.createElement("div");
    this.root.className = "af-video-preview";
    this.root.setAttribute("data-testid", "video-preview");

    this.imgEl = document.createElement("img");
    this.imgEl.className = "af-video-preview-image";
    this.imgEl.setAttribute("data-testid", "video-preview-image");
    this.imgEl.alt = "";
    this.root.appendChild(this.imgEl);

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
      this.imgEl.onerror = null;
      this.currentId = null;
      return;
    }

    this.root.removeAttribute("data-empty");
    if (this.currentId === game.id) return;
    this.currentId = game.id;

    this.detachVideo();

    if (this.loader) {
      const token = this.pendingFetchToken;
      // Start the image cascade and the video probe together, but hide
      // the image while the video has a chance to load — avoids the
      // ugly flash where a 16:9 screenshot sits behind a 4:3 <video>
      // during the couple of frames before `loadeddata` fires.
      this.root.classList.add("probing-video");
      this.tryImageCascade(
        this.imgEl,
        this.loader.screenshotCandidates(game.id, game.system),
        game.screenshotUrl,
        `${game.title} screenshot`,
      );
      this.tryMountVideo(game, token);
    } else {
      this.imgEl.onerror = null;
      if (game.screenshotUrl) this.imgEl.src = game.screenshotUrl;
      else this.imgEl.removeAttribute("src");
      this.imgEl.alt = `${game.title} screenshot`;
    }
  }

  /** Testing helper — the <video> element if one is currently mounted. */
  getVideoElement(): HTMLVideoElement | null {
    return this.currentVideoEl;
  }

  /** Freeze preview playback — called when the kiosk hands off to the
   * playing screen so the ArcadeDB clip isn't competing for audio or
   * CPU with the live emulator. */
  pauseVideo(): void {
    if (this.currentVideoEl) {
      try { this.currentVideoEl.pause(); } catch { /* ignore */ }
    }
  }

  /** Re-arm preview playback after a return to the browser. Muted if
   * autoplay blocks it — same retry shape as the initial mount. */
  resumeVideo(): void {
    const v = this.currentVideoEl;
    if (!v) return;
    void v.play().catch(() => {
      v.muted = true;
      void v.play().catch(() => { /* still blocked */ });
    });
  }

  private tryMountVideo(game: GameEntry, token: number): void {
    if (!this.loader) { this.revealImage(); return; }
    const candidates = this.loader.videoCandidates(game.id, game.system);
    if (candidates.length === 0) { this.revealImage(); return; }
    const loader = this.loader;
    const cacheKey = loader.cacheKey(game.id, "video");

    const video = document.createElement("video");
    video.className = "af-video-preview-video";
    video.setAttribute("data-testid", "video-preview-video");
    video.setAttribute("playsinline", "true");
    // Try to play with sound from the first frame. The loadeddata
    // handler below falls back to muted + retry when the browser's
    // autoplay policy rejects the call — we never auto-unmute later.
    video.muted = false;
    video.loop = true;

    let idx = 0;
    let objectUrl: string | null = null;
    const setSrc = (src: string, fromCache: boolean): void => {
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      if (fromCache) objectUrl = src;
      video.src = src;
    };
    const tryNext = (): void => {
      if (token !== this.pendingFetchToken) { video.remove(); return; }
      if (game.id !== this.currentId) { video.remove(); return; }
      if (idx >= candidates.length) {
        // Cascade exhausted → reveal the screenshot and drop the video.
        video.remove();
        this.revealImage();
        return;
      }
      setSrc(candidates[idx++]!, false);
    };
    video.addEventListener("error", () => tryNext());
    video.addEventListener("loadeddata", () => {
      if (token !== this.pendingFetchToken) return;
      if (game.id !== this.currentId) return;
      this.currentVideoEl = video;
      // Drive the CRT overlays off the real video aspect ratio so the
      // rounded corners and scanlines follow the actual image edges,
      // not the letterboxed object-fit box.
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw > 0 && vh > 0) {
        this.root.style.setProperty("--af-video-ar", `${vw} / ${vh}`);
      }
      this.root.classList.remove("probing-video");
      this.root.classList.add("has-video");
      // Prefer unmuted playback. Only fall back to muted when the
      // *first* preview of the session is blocked by the autoplay
      // policy; once we've successfully played with sound, stay
      // unmuted on wheel navigation instead of silently re-muting.
      void video.play()
        .then(() => { VideoPreview.audioUnlocked = true; })
        .catch(() => {
          if (VideoPreview.audioUnlocked) {
            // Audio was allowed earlier this session — retry once
            // unmuted; if still blocked, accept no-playback rather
            // than flipping to muted on every wheel move.
            void video.play().catch(() => { /* leave visible, silent */ });
            return;
          }
          video.muted = true;
          void video.play().catch(() => { /* still blocked — leave visible */ });
        });
    });

    this.root.appendChild(video);

    // Cache hit → serve the trimmed clip directly. Cache miss → stream
    // from the first candidate (ArcadeDB) while priming the cache in
    // the background so the next hover benefits from the short clip.
    loader.getCachedVideoUrl(cacheKey).then((cached) => {
      if (token !== this.pendingFetchToken) return;
      if (game.id !== this.currentId) return;
      if (cached) {
        setSrc(cached, true);
        return;
      }
      tryNext();
      void loader.primeVideoCache(cacheKey, candidates).catch(() => { /* best-effort */ });
    }).catch(() => {
      if (token !== this.pendingFetchToken) return;
      tryNext();
    });
  }

  private revealImage(): void {
    this.root.classList.remove("probing-video");
  }

  private tryImageCascade(
    img: HTMLImageElement,
    urls: string[],
    staticFallback: string | null,
    alt: string,
  ): void {
    img.alt = alt;
    let idx = 0;
    const applyFallback = (): void => {
      if (staticFallback) {
        img.onerror = null;
        img.src = staticFallback;
        return;
      }
      img.removeAttribute("src");
    };
    const tryNext = (): void => {
      if (idx >= urls.length) { applyFallback(); return; }
      img.onerror = tryNext;
      img.src = urls[idx++]!;
    };
    tryNext();
  }

  private detachVideo(): void {
    if (this.currentVideoEl) {
      try { this.currentVideoEl.pause(); } catch { /* ignore */ }
      const src = this.currentVideoEl.src;
      if (src.startsWith("blob:")) {
        try { URL.revokeObjectURL(src); } catch { /* ignore */ }
      }
      this.currentVideoEl.remove();
      this.currentVideoEl = null;
    }
    this.root.classList.remove("has-video");
    this.root.classList.remove("probing-video");
  }

  private cancelFade(): void {
    if (this.fadeTimerId !== null) {
      this.clearTimer(this.fadeTimerId);
      this.fadeTimerId = null;
    }
  }
}
