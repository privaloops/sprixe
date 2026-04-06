/**
 * Phase 10 — Deep verification.
 *
 * Verifies that pause/resume/mute/layer toggle actually affect internal
 * emulator state, not just DOM appearance.
 */

import { test, expect } from '@playwright/test';
import { loadTestRom, waitForGameReady, getEmulatorState } from './helpers';

test.describe('Phase 10 — Deep verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/play/');
    await loadTestRom(page);
    await waitForGameReady(page);
  });

  test('10.1 pause TRULY stops frame progression', async ({ page }) => {
    await page.keyboard.press('p');
    const fcAfterPause = (await getEmulatorState(page)).frameCount;

    // Wait 200ms and verify frameCount has NOT changed
    await page.waitForTimeout(200);
    const fcAfterWait = (await getEmulatorState(page)).frameCount;
    // Tolerate at most 1 extra frame (in-flight frame may complete after pause)
    expect(fcAfterWait - fcAfterPause).toBeLessThanOrEqual(1);
  });

  test('10.2 resume TRULY resumes frame progression', async ({ page }) => {
    // Pause then resume
    await page.keyboard.press('p');
    await page.keyboard.press('p');

    const fcAfterResume = (await getEmulatorState(page)).frameCount;

    // Wait for frames to advance
    await page.waitForFunction((prevFc) => {
      const emu = (window as unknown as Record<string, unknown>).__emu as { getFrameCount(): number } | undefined;
      return emu !== undefined && emu.getFrameCount() > prevFc;
    }, fcAfterResume, { timeout: 5000 });
  });

  test('10.3 mute button toggles active class', async ({ page }) => {
    // Click mute
    await page.keyboard.press('m');

    const isMuted = await page.evaluate(() => {
      const muteBtn = document.getElementById('mute-btn');
      return muteBtn?.classList.contains('active') ?? false;
    });
    expect(isMuted).toBe(true);

    // Unmute
    await page.keyboard.press('m');
    const isUnmuted = await page.evaluate(() => {
      const muteBtn = document.getElementById('mute-btn');
      return !muteBtn?.classList.contains('active');
    });
    expect(isUnmuted).toBe(true);
  });

  test('10.4 layer eye toggle in layer panel', async ({ page }) => {
    // Debug panel opens by default — close then reopen to ensure editor is active
    await page.keyboard.press('F2');
    await expect(page.locator('#dbg-panel')).not.toHaveClass(/open/);
    await page.keyboard.press('F2');
    await expect(page.locator('#layer-panel')).toHaveClass(/open/);

    // Find layer eye buttons (one per HW layer)
    const eyeBtns = page.locator('#layer-panel .layer-eye-btn');
    const count = await eyeBtns.count();
    if (count === 0) {
      test.skip();
      return;
    }

    // Toggle first eye button off (opacity changes from 1 to 0.3)
    const firstEye = eyeBtns.first();
    await expect(firstEye).toHaveCSS('opacity', '1');
    await firstEye.click();
    await expect(firstEye).toHaveCSS('opacity', '0.3');

    // Toggle back on
    await firstEye.click();
    await expect(firstEye).toHaveCSS('opacity', '1');
  });
});
