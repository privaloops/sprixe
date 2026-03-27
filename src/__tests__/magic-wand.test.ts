/**
 * Magic Wand tests — flood fill with RGB tolerance on GFX ROM tiles.
 *
 * Tests the wand logic by directly manipulating a 16x16 tile in a GFX ROM
 * buffer using writePixel/readPixel, then running the same algorithm as
 * SpriteEditor.magicWandTile().
 */

import { describe, it, expect } from 'vitest';
import { writePixel, readPixel } from '../editor/tile-encoder';

// ---------------------------------------------------------------------------
// Helpers — reproduce the wand algorithm in isolation
// ---------------------------------------------------------------------------

const CHAR_SIZE_16 = 128; // bytes per 16x16 tile

/**
 * Magic wand: flood fill erase with RGB tolerance.
 * Same algorithm as SpriteEditor.magicWandTile() but operates directly on a buffer.
 */
function magicWand(
  gfxRom: Uint8Array,
  tileCode: number,
  localX: number,
  localY: number,
  tolerance: number,
  palette: Array<[number, number, number]>,
): void {
  const tileW = 16;
  const tileH = 16;
  const targetIndex = readPixel(gfxRom, tileCode, localX, localY, tileW, tileH, CHAR_SIZE_16);
  if (targetIndex === 15) return; // already transparent

  const [tr, tg, tb] = palette[targetIndex] ?? [0, 0, 0];
  const tolSq = tolerance * tolerance;

  const visited = new Uint8Array(tileW * tileH);
  const queue: [number, number][] = [[localX, localY]];
  visited[localY * tileW + localX] = 1;

  while (queue.length > 0) {
    const [cx, cy] = queue.pop()!;
    writePixel(gfxRom, tileCode, cx, cy, 15, tileW, tileH, CHAR_SIZE_16);

    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= tileW || ny < 0 || ny >= tileH) continue;
      if (visited[ny * tileW + nx]) continue;
      visited[ny * tileW + nx] = 1;

      const ci = readPixel(gfxRom, tileCode, nx, ny, tileW, tileH, CHAR_SIZE_16);
      if (ci === 15) continue;
      const [cr, cg, cb] = palette[ci] ?? [0, 0, 0];
      const distSq = (cr - tr) ** 2 + (cg - tg) ** 2 + (cb - tb) ** 2;
      if (distSq <= tolSq) {
        queue.push([nx, ny]);
      }
    }
  }
}

/** Read all 16x16 pixels as a flat array of color indices. */
function readAllPixels(gfxRom: Uint8Array, tileCode: number): number[] {
  const pixels: number[] = [];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      pixels.push(readPixel(gfxRom, tileCode, x, y, 16, 16, CHAR_SIZE_16));
    }
  }
  return pixels;
}

/** Fill entire tile with a single color index. */
function fillTile(gfxRom: Uint8Array, tileCode: number, colorIndex: number): void {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      writePixel(gfxRom, tileCode, x, y, colorIndex, 16, 16, CHAR_SIZE_16);
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Magic Wand', () => {
  // Palette: 16 colors for testing
  const palette: Array<[number, number, number]> = [
    [0, 0, 0],       // 0: black
    [255, 0, 0],     // 1: red
    [0, 255, 0],     // 2: green
    [0, 0, 255],     // 3: blue
    [255, 255, 0],   // 4: yellow
    [128, 0, 0],     // 5: dark red
    [200, 0, 0],     // 6: medium red
    [255, 50, 50],   // 7: light red
    [100, 100, 100], // 8: gray
    [110, 110, 110], // 9: similar gray
    [200, 200, 200], // 10: light gray
    [50, 50, 50],    // 11: dark gray
    [0, 128, 0],     // 12: dark green
    [0, 200, 0],     // 13: medium green
    [128, 128, 0],   // 14: olive
    [0, 0, 0],       // 15: transparent (pen 15)
  ];

  it('erases single connected region of same color', () => {
    const gfxRom = new Uint8Array(CHAR_SIZE_16);
    fillTile(gfxRom, 0, 1); // fill with red (index 1)
    // Paint a small blue patch in the corner
    writePixel(gfxRom, 0, 0, 0, 3, 16, 16, CHAR_SIZE_16);
    writePixel(gfxRom, 0, 1, 0, 3, 16, 16, CHAR_SIZE_16);
    writePixel(gfxRom, 0, 0, 1, 3, 16, 16, CHAR_SIZE_16);

    // Wand on the blue patch (tolerance 0 = exact match)
    magicWand(gfxRom, 0, 0, 0, 0, palette);

    // Blue pixels should be transparent
    expect(readPixel(gfxRom, 0, 0, 0, 16, 16, CHAR_SIZE_16)).toBe(15);
    expect(readPixel(gfxRom, 0, 1, 0, 16, 16, CHAR_SIZE_16)).toBe(15);
    expect(readPixel(gfxRom, 0, 0, 1, 16, 16, CHAR_SIZE_16)).toBe(15);
    // Red pixels should be unchanged
    expect(readPixel(gfxRom, 0, 2, 0, 16, 16, CHAR_SIZE_16)).toBe(1);
  });

  it('does not erase disconnected regions of same color', () => {
    const gfxRom = new Uint8Array(CHAR_SIZE_16);
    fillTile(gfxRom, 0, 0); // fill with black

    // Two separate blue regions separated by black
    writePixel(gfxRom, 0, 0, 0, 3, 16, 16, CHAR_SIZE_16); // top-left
    writePixel(gfxRom, 0, 15, 15, 3, 16, 16, CHAR_SIZE_16); // bottom-right

    // Wand on top-left blue pixel
    magicWand(gfxRom, 0, 0, 0, 0, palette);

    // Top-left should be erased
    expect(readPixel(gfxRom, 0, 0, 0, 16, 16, CHAR_SIZE_16)).toBe(15);
    // Bottom-right should NOT be erased (disconnected)
    expect(readPixel(gfxRom, 0, 15, 15, 16, 16, CHAR_SIZE_16)).toBe(3);
  });

  it('does nothing on transparent pixel', () => {
    const gfxRom = new Uint8Array(CHAR_SIZE_16);
    fillTile(gfxRom, 0, 15); // all transparent

    magicWand(gfxRom, 0, 5, 5, 0, palette);

    // All should remain transparent
    const pixels = readAllPixels(gfxRom, 0);
    expect(pixels.every(p => p === 15)).toBe(true);
  });

  it('tolerance 0 only matches exact same color index', () => {
    const gfxRom = new Uint8Array(CHAR_SIZE_16);
    fillTile(gfxRom, 0, 1); // red

    // Replace center with similar red (index 6, rgb 200,0,0)
    writePixel(gfxRom, 0, 8, 8, 6, 16, 16, CHAR_SIZE_16);

    // Wand on the red area around center, tolerance 0
    magicWand(gfxRom, 0, 0, 0, 0, palette);

    // All index 1 (red) pixels should be erased
    expect(readPixel(gfxRom, 0, 0, 0, 16, 16, CHAR_SIZE_16)).toBe(15);
    // Index 6 (similar red) should NOT be erased
    expect(readPixel(gfxRom, 0, 8, 8, 16, 16, CHAR_SIZE_16)).toBe(6);
  });

  it('tolerance includes similar colors within RGB distance', () => {
    const gfxRom = new Uint8Array(CHAR_SIZE_16);
    // Fill with red (255,0,0)
    fillTile(gfxRom, 0, 1);
    // Replace a pixel with medium red (200,0,0) — distance = 55
    writePixel(gfxRom, 0, 1, 0, 6, 16, 16, CHAR_SIZE_16);
    // Replace another with dark red (128,0,0) — distance = 127
    writePixel(gfxRom, 0, 2, 0, 5, 16, 16, CHAR_SIZE_16);

    // Wand on red pixel at (0,0) with tolerance 60
    // Should erase red (exact) and medium red (dist=55 < 60)
    // Should NOT erase dark red (dist=127 > 60)
    magicWand(gfxRom, 0, 0, 0, 60, palette);

    expect(readPixel(gfxRom, 0, 0, 0, 16, 16, CHAR_SIZE_16)).toBe(15); // red erased
    expect(readPixel(gfxRom, 0, 1, 0, 16, 16, CHAR_SIZE_16)).toBe(15); // medium red erased
    expect(readPixel(gfxRom, 0, 2, 0, 16, 16, CHAR_SIZE_16)).toBe(5);  // dark red kept
  });

  it('high tolerance erases all non-transparent connected pixels', () => {
    const gfxRom = new Uint8Array(CHAR_SIZE_16);
    // Various colors
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        writePixel(gfxRom, 0, x, y, (x + y) % 14, 16, 16, CHAR_SIZE_16); // indices 0-13
      }
    }

    // Wand with tolerance 450 — max RGB distance is sqrt(255²+255²+255²) ≈ 441
    magicWand(gfxRom, 0, 0, 0, 450, palette);

    const pixels = readAllPixels(gfxRom, 0);
    expect(pixels.every(p => p === 15)).toBe(true);
  });

  it('flood fill respects tile boundaries', () => {
    const gfxRom = new Uint8Array(CHAR_SIZE_16 * 2); // 2 tiles
    fillTile(gfxRom, 0, 1); // tile 0: red

    // Write something to tile 1
    writePixel(gfxRom, 1, 0, 0, 2, 16, 16, CHAR_SIZE_16);

    // Wand on tile 0
    magicWand(gfxRom, 0, 0, 0, 0, palette);

    // Tile 0 should be fully erased
    expect(readPixel(gfxRom, 0, 0, 0, 16, 16, CHAR_SIZE_16)).toBe(15);
    // Tile 1 should be untouched
    expect(readPixel(gfxRom, 1, 0, 0, 16, 16, CHAR_SIZE_16)).toBe(2);
  });

  it('erases L-shaped connected region', () => {
    const gfxRom = new Uint8Array(CHAR_SIZE_16);
    fillTile(gfxRom, 0, 0); // black background

    // L-shape with green (index 2)
    writePixel(gfxRom, 0, 0, 0, 2, 16, 16, CHAR_SIZE_16);
    writePixel(gfxRom, 0, 0, 1, 2, 16, 16, CHAR_SIZE_16);
    writePixel(gfxRom, 0, 0, 2, 2, 16, 16, CHAR_SIZE_16);
    writePixel(gfxRom, 0, 1, 2, 2, 16, 16, CHAR_SIZE_16);
    writePixel(gfxRom, 0, 2, 2, 2, 16, 16, CHAR_SIZE_16);

    magicWand(gfxRom, 0, 0, 0, 0, palette);

    // All green pixels should be erased
    expect(readPixel(gfxRom, 0, 0, 0, 16, 16, CHAR_SIZE_16)).toBe(15);
    expect(readPixel(gfxRom, 0, 0, 1, 16, 16, CHAR_SIZE_16)).toBe(15);
    expect(readPixel(gfxRom, 0, 0, 2, 16, 16, CHAR_SIZE_16)).toBe(15);
    expect(readPixel(gfxRom, 0, 1, 2, 16, 16, CHAR_SIZE_16)).toBe(15);
    expect(readPixel(gfxRom, 0, 2, 2, 16, 16, CHAR_SIZE_16)).toBe(15);
    // Black pixels should be untouched
    expect(readPixel(gfxRom, 0, 1, 0, 16, 16, CHAR_SIZE_16)).toBe(0);
  });
});
