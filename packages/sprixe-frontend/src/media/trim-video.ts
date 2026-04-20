/**
 * trimVideoBlob — capture the first N seconds of a video blob and
 * re-encode as a looping WebM clip via MediaRecorder on a canvas.
 *
 * The source must be same-origin (fetched via /arcadedb proxy) so the
 * canvas isn't tainted and captureStream() stays usable. The canvas
 * captures the video frames; the audio track is pulled from the
 * source `<video>` via its own captureStream() and mixed into the
 * recorder input so the trimmed clip keeps sound. Returns null when
 * MediaRecorder is unavailable (jsdom, old Safari) — caller keeps
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
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

type CaptureableVideo = HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };

function captureAudioTracks(video: HTMLVideoElement): MediaStreamTrack[] {
  const v = video as CaptureableVideo;
  const capture = v.captureStream ?? v.mozCaptureStream;
  if (!capture) return [];
  try {
    const stream = capture.call(v);
    return stream.getAudioTracks();
  } catch {
    return [];
  }
}

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
  // Kept unmuted so captureStream() exposes the audio track — the
  // element is never added to the DOM and volume is forced to 0 so
  // the trimming pass stays silent from the user's perspective.
  video.muted = false;
  video.volume = 0;
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

    const canvasStream = canvas.captureStream(fps);
    const audioTracks = captureAudioTracks(video);
    const combined = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioTracks,
    ]);
    const recorder = new MediaRecorder(combined, { mimeType: mime });
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
