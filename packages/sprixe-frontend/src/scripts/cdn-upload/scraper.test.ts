import { describe, it, expect } from "vitest";
import {
  parseScreenScraperResponse,
  SCREENSHOT_MEDIA_TYPES,
  VIDEO_MEDIA_TYPES,
} from "./scraper";

/** Canonical-ish response shape cribbed from the real ScreenScraper v2 jsonGame.php
 *  output — trimmed to the fields the parser actually reads. */
function buildResponse(partial: Record<string, unknown> = {}) {
  return {
    response: {
      jeu: {
        id: "3",
        noms: [{ region: "wor", text: "Street Fighter II" }],
        dates: [
          { region: "wor", text: "1991-02-22" },
          { region: "us", text: "1991-05-01" },
        ],
        developpeur: { text: "Capcom" },
        medias: [
          { type: "ss", url: "https://cdn.screenscraper.fr/ss/sf2.png" },
          { type: "video", url: "https://cdn.screenscraper.fr/video/sf2.mp4" },
        ],
        ...partial,
      },
    },
  };
}

describe("parseScreenScraperResponse — happy path", () => {
  it("extracts title, year, publisher, screenshot + video URLs", () => {
    const result = parseScreenScraperResponse(buildResponse());
    expect(result).toEqual({
      title: "Street Fighter II",
      year: "1991",
      publisher: "Capcom",
      screenshotUrl: "https://cdn.screenscraper.fr/ss/sf2.png",
      videoUrl: "https://cdn.screenscraper.fr/video/sf2.mp4",
    });
  });

  it("picks the 'wor' (world) date in preference to others", () => {
    const result = parseScreenScraperResponse(
      buildResponse({
        dates: [
          { region: "us", text: "1992" },
          { region: "wor", text: "1991" },
        ],
      })
    );
    expect(result.year).toBe("1991");
  });

  it("falls back to any region when 'wor' is missing", () => {
    const result = parseScreenScraperResponse(
      buildResponse({
        dates: [{ region: "jp", text: "1988" }],
      })
    );
    expect(result.year).toBe("1988");
  });
});

describe("parseScreenScraperResponse — media type tolerance", () => {
  it("accepts mixrbv1 / mixrbv2 / screenshot as aliases for a screenshot", () => {
    for (const t of ["mixrbv1", "mixrbv2", "screenshot"]) {
      const r = parseScreenScraperResponse(
        buildResponse({ medias: [{ type: t, url: `https://example.com/${t}.png` }] })
      );
      expect(r.screenshotUrl).toBe(`https://example.com/${t}.png`);
    }
  });

  it("accepts video-normalized as a video alias", () => {
    const r = parseScreenScraperResponse(
      buildResponse({ medias: [{ type: "video-normalized", url: "https://example.com/n.mp4" }] })
    );
    expect(r.videoUrl).toBe("https://example.com/n.mp4");
  });

  it("unknown media types are ignored", () => {
    const r = parseScreenScraperResponse(
      buildResponse({ medias: [{ type: "marquee", url: "https://example.com/m.png" }] })
    );
    expect(r.screenshotUrl).toBeNull();
    expect(r.videoUrl).toBeNull();
  });
});

describe("parseScreenScraperResponse — missing / malformed input", () => {
  it("null response → all-null result", () => {
    expect(parseScreenScraperResponse(null)).toEqual({
      title: null,
      year: null,
      publisher: null,
      screenshotUrl: null,
      videoUrl: null,
    });
  });

  it("empty jeu → all-null result", () => {
    expect(parseScreenScraperResponse({ response: { jeu: {} } })).toEqual({
      title: null,
      year: null,
      publisher: null,
      screenshotUrl: null,
      videoUrl: null,
    });
  });

  it("game with noms as a plain string", () => {
    const r = parseScreenScraperResponse({
      response: { jeu: { noms: "Final Fight" } },
    });
    expect(r.title).toBe("Final Fight");
  });

  it("game with noms as an object", () => {
    const r = parseScreenScraperResponse({
      response: { jeu: { noms: { text: "Ghouls'n Ghosts" } } },
    });
    expect(r.title).toBe("Ghouls'n Ghosts");
  });

  it("picks the first named title when noms is a non-localised list", () => {
    const r = parseScreenScraperResponse({
      response: {
        jeu: {
          noms: [
            { text: "Cadillacs and Dinosaurs" },
            { text: "カディラックス" },
          ],
        },
      },
    });
    expect(r.title).toBe("Cadillacs and Dinosaurs");
  });

  it("ignores medias entries with non-string url or type", () => {
    const r = parseScreenScraperResponse(
      buildResponse({
        medias: [
          { type: "ss", url: 42 },
          { type: 5, url: "https://example.com/bad.png" },
          { type: "ss", url: "https://example.com/ok.png" },
        ],
      })
    );
    expect(r.screenshotUrl).toBe("https://example.com/ok.png");
  });

  it("returns null fields without throwing when response is not an object at all", () => {
    expect(parseScreenScraperResponse("garbage").title).toBeNull();
    expect(parseScreenScraperResponse(42).title).toBeNull();
    expect(parseScreenScraperResponse(undefined).title).toBeNull();
  });
});

describe("exported sets", () => {
  it("screenshot types include 'ss' and the mixrbv variants", () => {
    expect(SCREENSHOT_MEDIA_TYPES.has("ss")).toBe(true);
    expect(SCREENSHOT_MEDIA_TYPES.has("mixrbv1")).toBe(true);
    expect(SCREENSHOT_MEDIA_TYPES.has("mixrbv2")).toBe(true);
  });

  it("video types include 'video' and 'video-normalized'", () => {
    expect(VIDEO_MEDIA_TYPES.has("video")).toBe(true);
    expect(VIDEO_MEDIA_TYPES.has("video-normalized")).toBe(true);
  });
});
