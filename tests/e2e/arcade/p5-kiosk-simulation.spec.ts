import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { installGamepadMock } from "./_helpers/gamepad";

/**
 * p5-kiosk-simulation — runs under the `kiosk` project in
 * playwright.config.ts, which reproduces the Chromium flags that the
 * on-device service (`cage -- chromium --kiosk ...`) will use on the
 * RPi 5. Guards the invariants that would silently break a flashed
 * image: SharedArrayBuffer gated behind COOP/COEP, the kiosk-only
 * switches not clobbering the arcade flow, and a clean console.
 *
 * Doctrine (§5 Phase 5 sub 12):
 *   1. crossOriginIsolated === true
 *   2. SharedArrayBuffer is defined
 *   3. Boot → select → play → quit returns to the browser cleanly
 *   4. Zero console.error / console.warn during the run
 *   5. window.location stays on baseURL (no accidental nav)
 */

async function holdButton(page: Page, idx: number, ms: number): Promise<void> {
  await page.evaluate(
    async ([button, duration]) => {
      const hold = (window as unknown as { __holdButton: (n: number, d: number) => Promise<void> }).__holdButton;
      await hold(button as number, duration as number);
      await new Promise((r) => setTimeout(r, 60));
    },
    [idx, ms]
  );
}

// Console messages that are legitimately expected and don't indicate a
// regression. PeerJS opens with a warning on some networks while we
// still have the empty-state fallback; main.ts logs one warning when
// PeerHost.start() rejects (expected offline/CI). Keep this list
// minimal — anything unlisted fails the test.
const CONSOLE_WHITELIST: readonly RegExp[] = [
  /\[arcade\] PeerHost start failed/,
  /\[arcade\] RomDB unavailable/,
  // Chromium logs a top-level 'error' when hasVideo() HEAD-probes
  // /media/*/video.mp4 and the clip isn't on disk — that's the
  // expected 404 path from the vite media-not-found middleware, not
  // a regression.
  /Failed to load resource: the server responded with a status of 404/,
];

function isWhitelisted(message: string): boolean {
  return CONSOLE_WHITELIST.some((re) => re.test(message));
}

test.describe("Phase 5 — kiosk simulation", () => {
  test("boot → play → quit under kiosk flags stays isolated, quiet, and on-origin", async ({ page }, testInfo) => {
    const offendingMessages: string[] = [];
    const trackConsole = (msg: ConsoleMessage): void => {
      if (msg.type() !== "warning" && msg.type() !== "error") return;
      const text = msg.text();
      if (isWhitelisted(text)) return;
      offendingMessages.push(`${msg.type()}: ${text}`);
    };
    page.on("console", trackConsole);
    page.on("pageerror", (err) => offendingMessages.push(`pageerror: ${err.message}`));

    await installGamepadMock(page);
    await page.goto("/");
    const baseOrigin = new URL(page.url()).origin;

    // 1 — crossOriginIsolated + SharedArrayBuffer must be live, otherwise
    // the audio worker falls back to ScriptProcessorNode on main thread.
    const isolation = await page.evaluate(() => ({
      isolated: (self as unknown as { crossOriginIsolated: boolean }).crossOriginIsolated,
      hasSAB: typeof SharedArrayBuffer !== "undefined",
    }));
    expect(isolation.isolated).toBe(true);
    expect(isolation.hasSAB).toBe(true);

    // 2 — golden arcade flow: select the first game, verify playing
    // screen rasterises, quit via pause overlay.
    const browser = page.locator(".af-browser-screen");
    const playing = page.locator('[data-testid="playing-screen"]');
    const overlay = page.locator('[data-testid="pause-overlay"]');
    await expect(browser).toBeVisible();

    await holdButton(page, 0, 120); // confirm → enters PlayingScreen
    await expect(playing).toBeVisible();

    // Wait for the mock emulator's rAF loop to paint several frames.
    await page.waitForTimeout(200);
    const canvasPainted = await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="playing-canvas"]') as HTMLCanvasElement | null;
      const px = canvas?.getContext("2d")?.getImageData(10, 10, 1, 1).data;
      return !!px && px[0] + px[1] + px[2] > 0;
    });
    expect(canvasPainted).toBe(true);

    await holdButton(page, 8, 1200); // coin hold → pause opens
    await expect(overlay).toBeVisible();
    for (let i = 0; i < 3; i++) await holdButton(page, 13, 120); // nav to Quit
    await holdButton(page, 0, 120); // confirm quit
    await expect(browser).toBeVisible();
    await expect(playing).toHaveCount(0);

    // 3 — origin is still the kiosk's, no accidental redirect.
    expect(new URL(page.url()).origin).toBe(baseOrigin);

    // 4 — clean console (modulo the documented whitelist).
    page.off("console", trackConsole);
    if (offendingMessages.length) {
      testInfo.attach("offending-console", {
        body: offendingMessages.join("\n"),
        contentType: "text/plain",
      });
    }
    expect(offendingMessages).toEqual([]);
  });
});
