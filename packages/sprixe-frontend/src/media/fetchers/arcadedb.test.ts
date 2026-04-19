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

  it("builds videos URL with mp4 extension", () => {
    expect(arcadeDbUrl("videos", "kof97")).toBe(
      "https://adb.arcadeitalia.net/media/mame.current/videos/kof97.mp4",
    );
  });

  it("percent-encodes exotic romset ids", () => {
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
