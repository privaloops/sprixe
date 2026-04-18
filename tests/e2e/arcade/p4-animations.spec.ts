import { test, expect } from "@playwright/test";
import { installGamepadMock } from "./_helpers/gamepad";

/**
 * p4-animations — reduced-motion kicks the whole animation budget to
 * zero (§2.1). Verified at :root via the --af-motion token and on a
 * concrete element (.af-filter-pill) whose transition declaration
 * multiplies duration by var(--af-motion).
 */

test.describe("Phase 4 — reduced-motion cascade", () => {
  test("emulateMedia({ reducedMotion: 'reduce' }) drops --af-motion to 0 and transitions to 0s", async ({
    page,
  }) => {
    await installGamepadMock(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator(".af-browser-screen")).toBeVisible();

    const vars = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        motion: s.getPropertyValue("--af-motion").trim(),
        durSelection: s.getPropertyValue("--af-dur-selection").trim(),
        durScreen: s.getPropertyValue("--af-dur-screen").trim(),
        durOverlay: s.getPropertyValue("--af-dur-overlay").trim(),
      };
    });
    expect(vars.motion).toBe("0");
    expect(vars.durSelection).toBe("0ms");
    expect(vars.durScreen).toBe("0ms");
    expect(vars.durOverlay).toBe("0ms");

    // The active filter pill has a transition that scales with
    // --af-motion — under reduce, every duration resolves to 0.
    const activePill = page.locator(".af-filter-pill.active").first();
    await expect(activePill).toBeVisible();
    const durations = await activePill.evaluate((el) => {
      const s = getComputedStyle(el);
      return s.transitionDuration.split(",").map((v) => v.trim());
    });
    expect(durations.every((d) => d === "0s")).toBe(true);
  });

  test("without reduced-motion, --af-motion is 1 and transitions are non-zero", async ({ page }) => {
    await installGamepadMock(page);
    await page.goto("/");
    await expect(page.locator(".af-browser-screen")).toBeVisible();

    const motion = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--af-motion").trim()
    );
    expect(motion).toBe("1");
  });
});
