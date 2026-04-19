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

const BASE = "https://adb.arcadeitalia.net/media/mame.current";

export type ArcadeDbKind = "ingames" | "marquees" | "videos";

const EXT: Record<ArcadeDbKind, string> = {
  ingames: "png",
  marquees: "png",
  videos: "mp4",
};

export function arcadeDbUrl(kind: ArcadeDbKind, gameId: string): string {
  return `${BASE}/${kind}/${encodeURIComponent(gameId)}.${EXT[kind]}`;
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
