import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PreviewLoader,
  scheduleVideoFade,
  DEFAULT_CROSSFADE_DELAY_MS,
} from "./preview-loader";
import { MediaCache } from "./media-cache";

function makeBlob(contents: string): Blob {
  return new Blob([contents], { type: "image/png" });
}

let cacheCounter = 0;
function freshCache(): MediaCache {
  cacheCounter += 1;
  return new MediaCache(`sprixe-arcade-media-test-${cacheCounter}`);
}

describe("PreviewLoader", () => {
  const CDN = "https://cdn.sprixe.app/media";

  describe("URL builders", () => {
    it("screenshotUrl joins system + id + screenshot.png", () => {
      const loader = new PreviewLoader({ cache: freshCache(), cdnBase: CDN });
      expect(loader.screenshotUrl("sf2", "cps1")).toBe(
        "https://cdn.sprixe.app/media/cps1/sf2/screenshot.png",
      );
    });

    it("videoUrl joins system + id + video.mp4", () => {
      const loader = new PreviewLoader({ cache: freshCache(), cdnBase: CDN });
      expect(loader.videoUrl("mslug", "neogeo")).toBe(
        "https://cdn.sprixe.app/media/neogeo/mslug/video.mp4",
      );
    });

    it("marqueeUrl joins system + id + marquee.png", () => {
      const loader = new PreviewLoader({ cache: freshCache(), cdnBase: CDN });
      expect(loader.marqueeUrl("sf2", "cps1")).toBe(
        "https://cdn.sprixe.app/media/cps1/sf2/marquee.png",
      );
    });

    it("trailing slash on cdnBase is stripped", () => {
      const loader = new PreviewLoader({ cache: freshCache(), cdnBase: CDN + "/" });
      expect(loader.screenshotUrl("sf2", "cps1")).toBe(
        "https://cdn.sprixe.app/media/cps1/sf2/screenshot.png",
      );
    });

    it("cacheKey follows media:{gameId}:{kind} (video uses v2 suffix for audio-trim fix)", () => {
      const loader = new PreviewLoader({ cache: freshCache(), cdnBase: CDN });
      expect(loader.cacheKey("sf2", "screenshot")).toBe("media:sf2:screenshot");
      expect(loader.cacheKey("mslug", "video")).toBe("media:mslug:video-v2");
    });
  });

  describe("cascades", () => {
    it("screenshotCandidates lists operator CDN first, then ArcadeDB", () => {
      const loader = new PreviewLoader({ cache: freshCache(), cdnBase: CDN });
      const urls = loader.screenshotCandidates("sf2", "cps1");
      expect(urls).toEqual([
        "https://cdn.sprixe.app/media/cps1/sf2/screenshot.png",
        "https://adb.arcadeitalia.net/media/mame.current/ingames/sf2.png",
      ]);
    });

    it("marqueeCandidates lists operator CDN first, then ArcadeDB", () => {
      const loader = new PreviewLoader({ cache: freshCache(), cdnBase: CDN });
      const urls = loader.marqueeCandidates("mslug", "neogeo");
      expect(urls).toEqual([
        "https://cdn.sprixe.app/media/neogeo/mslug/marquee.png",
        "https://adb.arcadeitalia.net/media/mame.current/marquees/mslug.png",
      ]);
    });

    it("videoCandidates lists operator CDN, ArcadeDB HD, ArcadeDB SD", () => {
      const loader = new PreviewLoader({ cache: freshCache(), cdnBase: CDN });
      const urls = loader.videoCandidates("kof97", "neogeo");
      expect(urls).toHaveLength(3);
      expect(urls[0]).toBe("https://cdn.sprixe.app/media/neogeo/kof97/video.mp4");
      expect(urls[1]).toContain("download_file.php");
      expect(urls[1]).toContain("entity=shortplay_hd");
      expect(urls[2]).toContain("download_file.php");
      expect(urls[2]).toContain("entity=shortplay");
      expect(urls[2]).not.toContain("shortplay_hd");
    });

    it("videoCandidates drops the operator slot when no cdnBase is set", () => {
      const loader = new PreviewLoader({ cache: freshCache() });
      const urls = loader.videoCandidates("kof97", "neogeo");
      expect(urls).toHaveLength(2);
      expect(urls[0]).toContain("entity=shortplay_hd");
      expect(urls[1]).toContain("entity=shortplay");
    });
  });

  describe("video cache", () => {
    it("primeVideoCache fetches the first reachable candidate, trims, and stores", async () => {
      const cache = freshCache();
      const trimmed = new Blob([new Uint8Array(64)], { type: "video/webm" });
      const fetchMock = vi.fn(async () => new Response(new Uint8Array(1024), { status: 200, headers: { "content-type": "video/mp4" } }));
      vi.stubGlobal("fetch", fetchMock);
      const trimImpl = vi.fn(async (_: Blob, _seconds: number) => trimmed);

      const loader = new PreviewLoader({
        cache,
        cdnBase: CDN,
        trimVideoImpl: trimImpl,
      });

      const ok = await loader.primeVideoCache("media:sf2:video", ["https://cdn/a.mp4"]);
      expect(ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(trimImpl).toHaveBeenCalledTimes(1);
      expect(trimImpl.mock.calls[0]?.[1]).toBe(5);
      expect(await cache.get("media:sf2:video")).not.toBeNull();
      expect(await cache.totalSize()).toBe(64);
      vi.unstubAllGlobals();
    });

    it("primeVideoCache falls through to the next candidate on 404", async () => {
      const cache = freshCache();
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes("first")) return new Response(null, { status: 404 });
        return new Response(new Uint8Array(32), { status: 200, headers: { "content-type": "video/mp4" } });
      });
      vi.stubGlobal("fetch", fetchMock);
      const loader = new PreviewLoader({
        cache,
        cdnBase: CDN,
        trimVideoImpl: async (b) => b,
      });

      const got = await loader.primeVideoCache("media:x:video", [
        "https://cdn/first",
        "https://cdn/second",
      ]);
      expect(got).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      vi.unstubAllGlobals();
    });

    it("primeVideoCache dedupes concurrent calls for the same key", async () => {
      const cache = freshCache();
      let fetches = 0;
      vi.stubGlobal("fetch", vi.fn(async () => {
        fetches += 1;
        return new Response(new Uint8Array(8), { status: 200 });
      }));
      const trimImpl = vi.fn(async (b: Blob) => b);
      const loader = new PreviewLoader({ cache, cdnBase: CDN, trimVideoImpl: trimImpl });

      const [a, b] = await Promise.all([
        loader.primeVideoCache("media:k:video", ["https://cdn/a.mp4"]),
        loader.primeVideoCache("media:k:video", ["https://cdn/a.mp4"]),
      ]);
      expect(a).toBe(true);
      expect(b).toBe(true);
      expect(fetches).toBe(1);
      expect(trimImpl).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });

    it("primeVideoCache enforces LRU cap by evicting the oldest entries", async () => {
      const cache = freshCache();
      // Build a fresh Response per call — a Response body is single-use.
      vi.stubGlobal("fetch", vi.fn(async () =>
        new Response(new Uint8Array(400), { status: 200, headers: { "content-type": "video/webm" } })
      ));
      const loader = new PreviewLoader({
        cache,
        cdnBase: CDN,
        trimVideoImpl: async (b) => b,
        videoCacheBytes: 1000,
      });

      await loader.primeVideoCache("media:a:video", ["https://cdn/a.mp4"]);
      // addedAt resolution is ms — force a distinct timestamp for the next puts.
      await new Promise((r) => setTimeout(r, 2));
      await loader.primeVideoCache("media:b:video", ["https://cdn/b.mp4"]);
      await new Promise((r) => setTimeout(r, 2));
      await loader.primeVideoCache("media:c:video", ["https://cdn/c.mp4"]);

      // 3 × 400 = 1200 > 1000 → the oldest (a) must have been evicted.
      expect(await cache.get("media:a:video")).toBeNull();
      expect(await cache.get("media:b:video")).not.toBeNull();
      expect(await cache.get("media:c:video")).not.toBeNull();
      vi.unstubAllGlobals();
    });

    it("getCachedVideoUrl returns null on miss", async () => {
      const loader = new PreviewLoader({ cache: freshCache(), cdnBase: CDN });
      expect(await loader.getCachedVideoUrl("media:missing:video")).toBeNull();
    });
  });

  describe("generateMarqueeUrl", () => {
    it("delegates to the generator and persists the blob to cache", async () => {
      const blob = makeBlob("generated");
      const marqueeGenImpl = vi.fn(async () => blob);
      const cache = freshCache();
      const loader = new PreviewLoader({ cache, cdnBase: CDN, marqueeGenImpl });

      const url = await loader.generateMarqueeUrl("sf2", "Street Fighter II");
      expect(url).not.toBeNull();
      expect(marqueeGenImpl).toHaveBeenCalledWith("Street Fighter II");

      // Confirm the blob was persisted — skip the cache-hit URL check
      // because fake-indexeddb unwraps Blobs into plain Objects that
      // URL.createObjectURL rejects.
      const cached = await cache.get("media:sf2:marquee");
      expect(cached).not.toBeNull();
    });

    it("returns null when the generator itself yields null", async () => {
      const marqueeGenImpl = vi.fn(async () => null);
      const loader = new PreviewLoader({ cache: freshCache(), cdnBase: CDN, marqueeGenImpl });
      expect(await loader.generateMarqueeUrl("sf2", "Street Fighter II")).toBeNull();
    });
  });
});

describe("scheduleVideoFade", () => {
  let timers: { setTimeout: (cb: () => void, ms: number) => number; clearTimeout: (id: number) => void; fire: (id: number) => void };

  beforeEach(() => {
    const pending = new Map<number, () => void>();
    let idGen = 0;
    timers = {
      setTimeout: (cb) => {
        const id = ++idGen;
        pending.set(id, cb);
        return id;
      },
      clearTimeout: (id) => { pending.delete(id); },
      fire: (id) => {
        const cb = pending.get(id);
        if (cb) { pending.delete(id); cb(); }
      },
    };
  });

  it("fires the callback after the specified delay", () => {
    const cb = vi.fn();
    scheduleVideoFade(1000, cb, {
      setTimeout: timers.setTimeout as unknown as typeof setTimeout,
      clearTimeout: timers.clearTimeout as unknown as typeof clearTimeout,
    });
    expect(cb).not.toHaveBeenCalled();
    timers.fire(1);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("returns a cancel that prevents firing", () => {
    const cb = vi.fn();
    const cancel = scheduleVideoFade(1000, cb, {
      setTimeout: timers.setTimeout as unknown as typeof setTimeout,
      clearTimeout: timers.clearTimeout as unknown as typeof clearTimeout,
    });
    cancel();
    timers.fire(1);
    expect(cb).not.toHaveBeenCalled();
  });

  it("default delay constant is 1000 ms", () => {
    expect(DEFAULT_CROSSFADE_DELAY_MS).toBe(1000);
  });
});
