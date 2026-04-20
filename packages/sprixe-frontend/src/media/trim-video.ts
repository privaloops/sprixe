/**
 * trimVideoBlob — capture the first N seconds of a video blob and
 * re-encode as a looping WebM clip via MediaRecorder on a canvas.
 *
 * The source must be same-origin (fetched via /arcadedb proxy) so the
 * canvas isn't tainted and captureStream() stays usable. Returns null
 * when MediaRecorder is unavailable (jsdom, old Safari) — caller keeps
 * the untrimmed blob instead.
 */

export interface TrimVideoOptions {
  /** Seconds of clip to capture starting at t=0. Defaults to 5. */
  seconds?: number;
  /** Frame rate for the canvas stream. Defaults to 30. */
  fps?: number;
  /** Safety hard-stop on the recorder in ms. Defaults to seconds×3000. */
  timeoutMs?: number;
}

const PREFERRED_MIME_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

export async function trimVideoBlob(
  source: Blob,
  options: TrimVideoOptions = {},
): Promise<Blob | null> {
  const seconds = options.seconds ?? 5;
  const fps = options.fps ?? 30;
  const timeoutMs = options.timeoutMs ?? seconds * 3000;
  const mime = pickMimeType();
  if (!mime) return null;

  const sourceUrl = URL.createObjectURL(source);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = sourceUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      const onLoaded = (): void => { cleanup(); resolve(); };
      const onErr = (): void => { cleanup(); reject(new Error("video load failed")); };
      const cleanup = (): void => {
        video.removeEventListener("loadedmetadata", onLoaded);
        video.removeEventListener("error", onErr);
      };
      video.addEventListener("loadedmetadata", onLoaded, { once: true });
      video.addEventListener("error", onErr, { once: true });
    });

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 240;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const stream = canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunks: BlobPart[] = [];
    recorder.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    });
    const recorded = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });

    recorder.start();
    try {
      await video.play();
    } catch {
      recorder.stop();
      return null;
    }

    let stopped = false;
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      try { recorder.stop(); } catch { /* already stopped */ }
      try { video.pause(); } catch { /* ignore */ }
    };
    const safety = setTimeout(stop, timeoutMs);

    await new Promise<void>((resolve) => {
      const tick = (): void => {
        if (stopped) { resolve(); return; }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        if (video.currentTime >= seconds || video.ended) {
          stop();
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    });

    await recorded;
    clearTimeout(safety);
    if (chunks.length === 0) return null;
    return new Blob(chunks, { type: mime });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
