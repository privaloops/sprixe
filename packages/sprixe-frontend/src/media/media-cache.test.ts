import { describe, it, expect } from "vitest";
import { MediaCache } from "./media-cache";

let dbCounter = 0;
function freshCache(): MediaCache {
  dbCounter += 1;
  return new MediaCache(`sprixe-media-test-${dbCounter}`);
}

function blobOfSize(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "video/webm" });
}

describe("MediaCache", () => {
  it("put + get roundtrips a blob by key", async () => {
    const cache = freshCache();
    await cache.put("k", blobOfSize(32));
    // fake-indexeddb strips Blob metadata; totalSize relies on the
    // explicit `size` field we persist alongside.
    expect(await cache.get("k")).not.toBeNull();
    expect(await cache.totalSize()).toBe(32);
  });

  it("delete removes an entry", async () => {
    const cache = freshCache();
    await cache.put("k", blobOfSize(8));
    await cache.delete("k");
    expect(await cache.get("k")).toBeNull();
  });

  it("totalSize sums stored blob sizes", async () => {
    const cache = freshCache();
    await cache.put("a", blobOfSize(10));
    await cache.put("b", blobOfSize(25));
    expect(await cache.totalSize()).toBe(35);
  });

  it("evictUntilUnder is a no-op when already under the cap", async () => {
    const cache = freshCache();
    await cache.put("a", blobOfSize(100));
    expect(await cache.evictUntilUnder(1000)).toBe(0);
    expect(await cache.get("a")).not.toBeNull();
  });

  it("evictUntilUnder drops oldest entries first until the cap is satisfied", async () => {
    const cache = freshCache();
    await cache.put("oldest", blobOfSize(200));
    await new Promise((r) => setTimeout(r, 2));
    await cache.put("middle", blobOfSize(200));
    await new Promise((r) => setTimeout(r, 2));
    await cache.put("newest", blobOfSize(200));

    const dropped = await cache.evictUntilUnder(300);
    expect(dropped).toBe(2);
    expect(await cache.get("oldest")).toBeNull();
    expect(await cache.get("middle")).toBeNull();
    expect(await cache.get("newest")).not.toBeNull();
  });
});
