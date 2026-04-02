/**
 * Game Matrix — automated testing of all ROMs in public/roms/.
 *
 * Level 1: Boot — canvas has non-black pixels after 600 frames
 * Level 2: Audio — audio worker is active (standard CPS1) or QSound flag set
 */

import { test, expect } from '@playwright/test';
import { readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROMS_DIR = join(__dirname, '..', '..', 'public', 'roms');

// Skip gracefully if public/roms/ doesn't exist (CI, fresh clone)
const romFiles = existsSync(ROMS_DIR)
  ? readdirSync(ROMS_DIR, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith('.zip'))
      .map(e => e.name.replace('.zip', ''))
      .sort()
  : [];

/** Load a ROM via the game selector and wait for emulator to start */
async function loadRom(page: import('@playwright/test').Page, rom: string): Promise<void> {
  await page.goto('/play/');

  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__emu !== undefined,
    { timeout: 15_000 },
  );

  await page.selectOption('#game-select', rom);
  await page.click('#load-btn');
  await page.waitForSelector('#drop-zone.hidden', { state: 'attached', timeout: 15_000 });

  await page.waitForFunction(() => {
    const emu = (window as unknown as Record<string, unknown>).__emu as { getFrameCount(): number } | undefined;
    return emu && emu.getFrameCount() > 0;
  }, { timeout: 10_000 });
}

/** Fast-forward N frames in batches to avoid blocking the page */
async function fastForward(page: import('@playwright/test').Page, frames: number): Promise<void> {
  const BATCH = 100;
  const batches = Math.ceil(frames / BATCH);
  for (let b = 0; b < batches; b++) {
    const n = Math.min(BATCH, frames - b * BATCH);
    await page.evaluate((count) => {
      const emu = (window as unknown as Record<string, unknown>).__emu as {
        pause(): void; stepFrame(): void;
      };
      emu.pause();
      for (let i = 0; i < count; i++) emu.stepFrame();
    }, n);
  }
}

/** Check canvas has non-black content via toDataURL (preserveDrawingBuffer) */
async function canvasHasContent(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const cvs = document.getElementById('screen') as HTMLCanvasElement;
    if (!cvs) return false;
    // Draw WebGL canvas to a 2D canvas to read pixels
    const tmp = document.createElement('canvas');
    tmp.width = cvs.width;
    tmp.height = cvs.height;
    const ctx = tmp.getContext('2d')!;
    ctx.drawImage(cvs, 0, 0);
    const data = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
    let nonBlack = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! > 0 || data[i + 1]! > 0 || data[i + 2]! > 0) nonBlack++;
    }
    // Any non-black pixel = game rendered something (even dark intros)
    return nonBlack > 0;
  });
}

test.describe('Game Matrix', () => {
  test.setTimeout(90_000);

  for (const rom of romFiles) {
    test.describe(rom, () => {

      test('Level 1 — boot (canvas not black)', async ({ page }) => {
        await loadRom(page, rom);
        await fastForward(page, 900);

        const hasContent = await canvasHasContent(page);
        expect(hasContent).toBe(true);
      });

      test('Level 2 — audio active', async ({ page }) => {
        await loadRom(page, rom);
        await fastForward(page, 300);

        const audioOk = await page.evaluate(() => {
          const emu = (window as unknown as Record<string, unknown>).__emu as
            { audioWorkerReady: boolean } & Record<string, unknown> | undefined;
          if (!emu) return false;
          return emu.audioWorkerReady || emu['isQSound'];
        });
        expect(audioOk).toBe(true);
      });
    });
  }
});
