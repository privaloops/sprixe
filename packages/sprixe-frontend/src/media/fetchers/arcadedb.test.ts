import { describe, it, expect, vi } from "vitest";
import { arcadeDbUrl, fetchArcadeDbAsset } from "./arcadedb";

describe("arcadeDbUrl", () => {
  it("builds ingames URL with romset short-name", () => {
    expect(arcadeDbUrl("ingames", "sf2")).toBe(
      "https://adb.arcadeitalia.net/media/mame.current/ingames/sf2.png",
    );
  });

  it("builds marquees URL", () => {
    expect(arcadeDbUrl("marquees", "mslug")).toBe(
      "https://adb.arcadeitalia.net/media/mame.current/marquees/mslug.png",
    );
  });

  it("builds HD video URL via ArcadeDB's download_file.php endpoint", () => {
    const url = arcadeDbUrl("videos", "kof97");
    expect(url.startsWith("https://adb.arcadeitalia.net/download_file.php?")).toBe(true);
    expect(url).toContain("tipo=mame_current");
    expect(url).toContain("codice=kof97");
    expect(url).toContain("entity=shortplay_hd");
    expect(url).toContain("filler=kof97.mp4");
  });

  it("percent-encodes exotic romset ids on image URLs", () => {
    expect(arcadeDbUrl("ingames", "pacman:plus")).toContain("pacman%3Aplus.png");
  });
});

describe("fetchArcadeDbAsset", () => {
  const makeResponse = (ok: boolean, payload = "bytes"): Response =>
    ({ ok, blob: async () => new Blob([payload]) } as unknown as Response);

  it("returns the blob on 200", async () => {
    const fetchImpl = vi.fn(async () => makeResponse(true)) as unknown as typeof fetch;
    expect(await fetchArcadeDbAsset("ingames", "sf2", fetchImpl)).not.toBeNull();
  });

  it("returns null on 404", async () => {
    const fetchImpl = vi.fn(async () => makeResponse(false)) as unknown as typeof fetch;
    expect(await fetchArcadeDbAsset("marquees", "nope", fetchImpl)).toBeNull();
  });

  it("returns null on network error", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    expect(await fetchArcadeDbAsset("videos", "sf2", fetchImpl)).toBeNull();
  });
});
