/**
 * libretro-thumbnails fetcher — pulls screenshot ("snap") and
 * title-screen PNGs from the community-maintained CC0 repository on
 * GitHub. No auth key, no rate-limit chokepoints, static URLs served
 * via GitHub Raw with `Access-Control-Allow-Origin: *`.
 *
 * Repository: https://github.com/libretro-thumbnails/MAME
 * Paths used:
 *   Named_Snaps/{id}.png   — gameplay screenshot
 *   Named_Titles/{id}.png  — title-screen (our primary marquee source)
 *
 * The `id` is the MAME romset name (sf2, ffight, mslug, kof97…), so
 * RomDB record ids align 1:1. Any other mapping would require a
 * manifest — we take the tradeoff and let 404s fall through to the
 * fallback generator.
 */

const BASE =
  "https://raw.githubusercontent.com/libretro-thumbnails/MAME/master";

export type LibretroAsset = "snap" | "title";

const PATH: Record<LibretroAsset, string> = {
  snap: "Named_Snaps",
  title: "Named_Titles",
};

/** Build the raw-file URL for a given asset and game id. */
export function libretroUrl(kind: LibretroAsset, gameId: string): string {
  return `${BASE}/${PATH[kind]}/${encodeURIComponent(gameId)}.png`;
}

/**
 * GET the asset and return the response body as a Blob, or null on
 * any failure (404, network, CORS). Callers fall through to the next
 * layer in the preview-loader cascade.
 */
export async function fetchLibretroAsset(
  kind: LibretroAsset,
  gameId: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<Blob | null> {
  try {
    const response = await fetchImpl(libretroUrl(kind, gameId));
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  }
}
