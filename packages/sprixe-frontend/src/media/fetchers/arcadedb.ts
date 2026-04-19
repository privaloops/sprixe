/**
 * ArcadeDB fetcher — adb.arcadeitalia.net, the asset host Recalbox /
 * Batocera point at by default. Files are named after the MAME romset
 * short-name (sf2, ffight, mslug, kof97…) so they align 1:1 with our
 * RomDB ids. Covers screenshots, marquees AND gameplay videos out of
 * the box — no API key, no manifest.
 *
 * Paths (HTTPS, CORS-open):
 *   /media/mame.current/ingames/{id}.png     — gameplay screenshot
 *   /media/mame.current/marquees/{id}.png    — marquee banner
 *   /media/mame.current/videos/{id}.mp4      — short gameplay clip
 *
 * Missing assets return 404 — the caller falls through to the next
 * layer of the preview-loader cascade.
 */

const IMG_BASE = "https://adb.arcadeitalia.net/media/mame.current";
const DOWNLOAD_BASE = "https://adb.arcadeitalia.net/download_file.php";

export type ArcadeDbKind = "ingames" | "marquees" | "videos";

/**
 * Screenshots + marquees sit under `/media/mame.current/{kind}/{id}.png`.
 * Videos use a different endpoint (`download_file.php`) because
 * ArcadeDB bundles the MP4 through a PHP handler — the direct
 * `/media/.../videos/*.mp4` path 404s.
 */
export function arcadeDbUrl(kind: ArcadeDbKind, gameId: string): string {
  const id = encodeURIComponent(gameId);
  if (kind === "videos") {
    // Prefer the HD short clip; falls back to the standard one via
    // the <video> onerror cascade in the caller.
    const params = new URLSearchParams({
      tipo: "mame_current",
      codice: gameId,
      entity: "shortplay_hd",
      oper: "download",
      filler: `${gameId}.mp4`,
    });
    return `${DOWNLOAD_BASE}?${params.toString()}`;
  }
  return `${IMG_BASE}/${kind}/${id}.png`;
}

/** Secondary video URL — standard-quality shortplay, used when HD 404s. */
export function arcadeDbVideoSdUrl(gameId: string): string {
  const params = new URLSearchParams({
    tipo: "mame_current",
    codice: gameId,
    entity: "shortplay",
    oper: "download",
    filler: `${gameId}.mp4`,
  });
  return `${DOWNLOAD_BASE}?${params.toString()}`;
}

/**
 * GET the asset and return its body as a Blob, or null on any
 * failure (404, network, CORS). Never throws — callers chain the
 * result into the preview-loader cascade.
 */
export async function fetchArcadeDbAsset(
  kind: ArcadeDbKind,
  gameId: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<Blob | null> {
  try {
    const response = await fetchImpl(arcadeDbUrl(kind, gameId));
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  }
}
