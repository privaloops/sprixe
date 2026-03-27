/**
 * Phase 15 — Editor new features: wand tool, zoom/pan, tooltips, status bar, erase shortcut.
 */

import { test, expect } from '@playwright/test';
import { loadTestRom, waitForGameReady } from './helpers';

test.describe('Phase 15 — Editor new features', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await loadTestRom(page);
    await waitForGameReady(page);
    // Pause for stable state
    await page.keyboard.press('p');
  });

  // ── Wand tool ──

  test('15.1 W key activates wand tool', async ({ page }) => {
    await page.keyboard.press('w');
    const btn = page.locator('.edit-tool-btn', { hasText: 'Wand' });
    await expect(btn).toHaveClass(/active/);
  });

  test('15.2 wand tool button exists in toolbar', async ({ page }) => {
    const btn = page.locator('.edit-tool-btn', { hasText: 'Wand' });
    await expect(btn).toBeAttached();
  });

  test('15.3 clicking wand button activates it', async ({ page }) => {
    await page.click('.edit-tool-btn >> text=Wand');
    const btn = page.locator('.edit-tool-btn', { hasText: 'Wand' });
    await expect(btn).toHaveClass(/active/);
  });

  // ── Erase tile shortcut ──

  test('15.4 erase tile button exists', async ({ page }) => {
    const btn = page.locator('.edit-actions .ctrl-btn', { hasText: 'Erase Tile' });
    await expect(btn).toBeAttached();
  });

  // ── Tooltips ──

  test('15.5 tooltip element exists in DOM after editor opens', async ({ page }) => {
    const tt = page.locator('.tt');
    await expect(tt).toBeAttached();
  });

  test('15.6 tooltip is hidden by default', async ({ page }) => {
    const tt = page.locator('.tt');
    await expect(tt).toHaveCSS('display', 'none');
  });

  test('15.7 buttons have data-tt attribute (custom tooltip)', async ({ page }) => {
    const undoBtn = page.locator('.edit-actions .ctrl-btn', { hasText: 'Undo' });
    const tt = await undoBtn.getAttribute('data-tt');
    expect(tt).toContain('Undo');
    expect(tt).toContain('Ctrl+Z');
  });

  test('15.8 native title attributes are removed', async ({ page }) => {
    const undoBtn = page.locator('.edit-actions .ctrl-btn', { hasText: 'Undo' });
    const title = await undoBtn.getAttribute('title');
    expect(title).toBeNull();
  });

  test('15.9 tool buttons have descriptive tooltips', async ({ page }) => {
    const pencilBtn = page.locator('.edit-tool-btn', { hasText: 'Pencil' });
    const tt = await pencilBtn.getAttribute('data-tt');
    expect(tt).toContain('Pencil');
    expect(tt).toContain('B');
    expect(tt).toContain('Draw pixels');
  });

  test('15.10 wand button has tooltip with description', async ({ page }) => {
    const wandBtn = page.locator('.edit-tool-btn', { hasText: 'Wand' });
    const tt = await wandBtn.getAttribute('data-tt');
    expect(tt).toContain('Wand');
    expect(tt).toContain('W');
    expect(tt).toContain('similar colors');
  });

  // ── Status bar ──

  test('15.11 status bar exists', async ({ page }) => {
    const bar = page.locator('.edit-status-bar');
    await expect(bar).toBeAttached();
  });

  test('15.12 status bar shows tool hint', async ({ page }) => {
    await page.keyboard.press('b'); // pencil
    const bar = page.locator('.edit-status-bar');
    await expect(bar).toContainText('draw');
  });

  test('15.13 status bar updates on tool switch', async ({ page }) => {
    await page.keyboard.press('g'); // fill
    const bar = page.locator('.edit-status-bar');
    await expect(bar).toContainText('flood fill');
  });

  test('15.14 wand status shows tolerance', async ({ page }) => {
    await page.keyboard.press('w');
    const bar = page.locator('.edit-status-bar');
    await expect(bar).toContainText('tolerance');
  });

  // ── Zoom/pan ──

  test('15.15 tile canvas starts with no transform', async ({ page }) => {
    const canvas = page.locator('.edit-tile-canvas');
    const transform = await canvas.evaluate(el => el.style.transform);
    expect(transform).toBe('');
  });

  test('15.16 tile section has overflow hidden', async ({ page }) => {
    const section = page.locator('.edit-tile-section');
    await expect(section).toHaveCSS('overflow', 'hidden');
  });

  test('15.17 wheel zoom applies transform on tile canvas', async ({ page }) => {
    const canvas = page.locator('.edit-tile-canvas');
    // Scroll up to zoom in
    await canvas.dispatchEvent('wheel', { deltaY: -100, clientX: 400, clientY: 400 });
    await page.waitForTimeout(50);
    const transform = await canvas.evaluate(el => el.style.transform);
    expect(transform).toContain('scale');
  });

  test('15.18 wheel zoom out returns to no transform', async ({ page }) => {
    const canvas = page.locator('.edit-tile-canvas');
    // Zoom in then out
    await canvas.dispatchEvent('wheel', { deltaY: -100, clientX: 400, clientY: 400 });
    await page.waitForTimeout(50);
    await canvas.dispatchEvent('wheel', { deltaY: 100, clientX: 400, clientY: 400 });
    await canvas.dispatchEvent('wheel', { deltaY: 100, clientX: 400, clientY: 400 });
    await canvas.dispatchEvent('wheel', { deltaY: 100, clientX: 400, clientY: 400 });
    await canvas.dispatchEvent('wheel', { deltaY: 100, clientX: 400, clientY: 400 });
    await page.waitForTimeout(50);
    const transform = await canvas.evaluate(el => el.style.transform);
    expect(transform).toBe('');
  });

  test('15.19 key 0 resets zoom', async ({ page }) => {
    const canvas = page.locator('.edit-tile-canvas');
    // Zoom in
    await canvas.dispatchEvent('wheel', { deltaY: -100, clientX: 400, clientY: 400 });
    await page.waitForTimeout(50);
    // Press 0 to reset
    await page.keyboard.press('0');
    await page.waitForTimeout(50);
    const transform = await canvas.evaluate(el => el.style.transform);
    expect(transform).toBe('');
  });

  test('15.20 status bar shows zoom info when zoomed', async ({ page }) => {
    const canvas = page.locator('.edit-tile-canvas');
    await canvas.dispatchEvent('wheel', { deltaY: -100, clientX: 400, clientY: 400 });
    await page.waitForTimeout(50);
    const bar = page.locator('.edit-status-bar');
    await expect(bar).toContainText('Zoom');
  });

  // ── HUD button ──

  test('15.21 HUD toggle button visible in editor mode', async ({ page }) => {
    const hud = page.locator('#toggle-emu-bar-btn');
    await expect(hud).toBeVisible();
  });
});
