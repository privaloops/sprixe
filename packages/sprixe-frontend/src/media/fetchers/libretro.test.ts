import { describe, it, expect, vi } from "vitest";
import { fetchLibretroAsset, libretroUrl } from "./libretro";

describe("libretroUrl", () => {
  it("builds Named_Snaps URL for MAME", () => {
    expect(libretroUrl("snap", "sf2")).toBe(
      "https://raw.githubusercontent.com/libretro-thumbnails/MAME/master/Named_Snaps/sf2.png",
    );
  });

  it("builds Named_Titles URL for MAME", () => {
    expect(libretroUrl("title", "mslug")).toBe(
      "https://raw.githubusercontent.com/libretro-thumbnails/MAME/master/Named_Titles/mslug.png",
    );
  });

  it("percent-encodes game ids to survive odd MAME names", () => {
    expect(libretroUrl("snap", "pacman:plus")).toContain("pacman%3Aplus.png");
  });
});

describe("fetchLibretroAsset", () => {
  const makeResponse = (ok: boolean, payload = "bytes"): Response =>
    ({ ok, blob: async () => new Blob([payload]) } as unknown as Response);

  it("returns the blob on 200", async () => {
    const fetchImpl = vi.fn(async () => makeResponse(true)) as unknown as typeof fetch;
    const blob = await fetchLibretroAsset("snap", "sf2", fetchImpl);
    expect(blob).not.toBeNull();
  });

  it("returns null on 404", async () => {
    const fetchImpl = vi.fn(async () => makeResponse(false)) as unknown as typeof fetch;
    expect(await fetchLibretroAsset("snap", "nope", fetchImpl)).toBeNull();
  });

  it("swallows network errors and returns null", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    expect(await fetchLibretroAsset("title", "sf2", fetchImpl)).toBeNull();
  });
});
