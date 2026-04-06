/**
 * PixelLab → ROM conversion pipeline (Inpainting approach).
 *
 * For each captured pose:
 *   1. Render the original sprite from GFX ROM tiles → composed image
 *   2. Build a mask: white where tiles exist, black elsewhere
 *   3. Call /inpaint with description + mask + palette
 *   4. PixelLab generates new character constrained to the tile layout
 *   5. Write pixels back to the same tile addresses
 *
 * This guarantees zero overflow — the AI paints ONLY within the tile mask.
 */

import pako from 'pako';
import type { Base64Image, ImageSize } from './pixellab-types';
import type { CapturedPose } from '../editor/sprite-analyzer';
import { readTile } from '../editor/tile-encoder';

// ---------------------------------------------------------------------------
// Build composed image + mask from a captured pose
// ---------------------------------------------------------------------------

export interface PoseRender {
  /** Composed RGBA image of the pose */
  image: ImageData;
  /** Mask: white (255) where tiles exist, black (0) elsewhere */
  mask: ImageData;
  /** Canvas dimensions */
  width: number;
  height: number;
}

/**
 * Render a captured pose to RGBA + mask from GFX ROM tiles.
 */
export function renderPoseForInpaint(
  gfxRom: Uint8Array,
  pose: CapturedPose,
  palette: Array<[number, number, number]>,
): PoseRender {
  const w = pose.w;
  const h = pose.h;

  const imageData = new ImageData(w, h);
  const maskData = new ImageData(w, h);
  const img = imageData.data;
  const msk = maskData.data;

  for (const tile of pose.tiles) {
    const tilePixels = readTile(gfxRom, tile.mappedCode);

    for (let ty = 0; ty < 16; ty++) {
      for (let tx = 0; tx < 16; tx++) {
        const srcX = tile.flipX ? 15 - tx : tx;
        const srcY = tile.flipY ? 15 - ty : ty;
        const ci = tilePixels[srcY * 16 + srcX]!;

        const dx = tile.relX + tx;
        const dy = tile.relY + ty;
        if (dx < 0 || dx >= w || dy < 0 || dy >= h) continue;

        const di = (dy * w + dx) * 4;

        // Mask: white for all tile pixels (including transparent ones)
        msk[di] = 255;
        msk[di + 1] = 255;
        msk[di + 2] = 255;
        msk[di + 3] = 255;

        // Image: render non-transparent pixels
        if (ci !== 15) {
          const [r, g, b] = palette[ci] ?? [0, 0, 0];
          img[di] = r;
          img[di + 1] = g;
          img[di + 2] = b;
          img[di + 3] = 255;
        }
        // ci === 15 → transparent, leave as black/transparent in image
      }
    }
  }

  return { image: imageData, mask: maskData, width: w, height: h };
}

// ---------------------------------------------------------------------------
// Convert inpainted result back to indexed pixels for ROM write-back
// ---------------------------------------------------------------------------

/**
 * Quantize an RGBA blob to palette-indexed pixels.
 * Returns indexed pixels (w × h) for writing back to tiles.
 */
export async function quantizeInpaintResult(
  blob: Blob,
  palette: Array<[number, number, number]>,
): Promise<{ indexed: Uint8Array; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const rgba = imgData.data;
  const w = bitmap.width;
  const h = bitmap.height;

  const indexed = new Uint8Array(w * h).fill(15);

  for (let i = 0; i < w * h; i++) {
    const si = i * 4;
    const a = rgba[si + 3]!;
    if (a < 128) continue; // transparent

    const r = rgba[si]!, g = rgba[si + 1]!, b = rgba[si + 2]!;
    let bestIdx = 0, bestDist = Infinity;
    for (let c = 0; c < 16; c++) {
      if (c === 15) continue;
      const [pr, pg, pb] = palette[c]!;
      const dr = r - pr, dg = g - pg, db = b - pb;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) { bestDist = dist; bestIdx = c; }
    }
    indexed[i] = bestIdx;
  }

  return { indexed, width: w, height: h };
}

// ---------------------------------------------------------------------------
// ImageData → Base64Image helper
// ---------------------------------------------------------------------------

export function imageDataToBase64PNG(img: ImageData): Base64Image {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(img, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');
  return { base64: dataUrl.split(',')[1]! };
}
