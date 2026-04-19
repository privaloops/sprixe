import { describe, it, expect } from "vitest";
import { generateMarquee } from "./generated-marquee";

describe("generateMarquee", () => {
  // jsdom does not implement canvas getContext; the generator has to
  // detect that and return null instead of throwing. This is the
  // contract the preview-loader cascade relies on: a missing canvas
  // surface must not explode the hover pipeline.
  it("returns null gracefully when canvas context is unavailable", async () => {
    const result = await generateMarquee("Street Fighter II");
    expect(result).toBeNull();
  });
});
