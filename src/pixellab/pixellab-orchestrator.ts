/**
 * PixelLab orchestrator — inpainting-based character replacement.
 *
 * For each tagged pose:
 *   1. Render the original sprite from tiles → image + mask
 *   2. /inpaint with description + mask + palette → new character in same layout
 *   3. Quantize result → write pixels back to the same tiles
 *
 * The mask constrains generation to the exact tile layout. Zero overflow.
 */

import type { Emulator } from '../emulator';
import type { SpriteEditor } from '../editor/sprite-editor';
import type { LayerGroup } from '../editor/layer-model';
import type { GenerateConfig } from './pixellab-modal';
import { PixelLabClient, paletteToColorImage } from './pixellab-client';
import { renderPoseForInpaint, quantizeInpaintResult, imageDataToBase64PNG } from './pixellab-convert';
import { writePixel } from '../editor/tile-encoder';
import { readPalette } from '../editor/palette-editor';
import { updatePixelLabProgress } from './pixellab-modal';
import { showToast } from '../ui/toast';

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

export async function runPixelLabGeneration(
  emulator: Emulator,
  editor: SpriteEditor,
  layerGroups: LayerGroup[],
  groupIdx: number,
  config: GenerateConfig,
  modalEl: HTMLElement,
  onRefresh: () => void,
): Promise<void> {
  const group = layerGroups[groupIdx];
  const capture = group?.spriteCapture;
  if (!capture) throw new Error('No sprite capture');

  const poses = capture.poses;
  const tags = capture.poseAnimTags ?? [];
  const palIdx = capture.palette;

  const video = emulator.getVideo();
  const bufs = emulator.getBusBuffers();
  if (!video || !bufs) throw new Error('Emulator not ready');

  const gfxRom = editor.getGfxRom();
  if (!gfxRom) throw new Error('No GFX ROM');

  const colors = poses[0]?.capturedColors ?? readPalette(bufs.vram, video.getPaletteBase(), palIdx);

  const client = new PixelLabClient({
    apiKey: config.apiKey,
    apiUrl: 'https://api.pixellab.ai/v1',
  });

  const colorImage = paletteToColorImage(colors);

  // Optional reference photo
  let initImage: { base64: string } | undefined;
  if (config.referencePhoto) {
    const photoData = await config.referencePhoto.arrayBuffer();
    initImage = { base64: uint8ToBase64(new Uint8Array(photoData)) };
  }

  // Collect tagged poses
  const taggedPoses: Array<{ poseIdx: number; tag: string }> = [];
  for (let i = 0; i < poses.length; i++) {
    if (tags[i]) taggedPoses.push({ poseIdx: i, tag: `${tags[i]!.template}_${tags[i]!.frame}` });
  }

  if (taggedPoses.length === 0) {
    showToast('No poses tagged — tag poses in the sprite sheet first', false);
    return;
  }

  const desc = config.referencePhoto
    ? config.description + '. Use the face from the reference photo.'
    : config.description;

  let posesWritten = 0;
  // Reference image from first inpainted pose — ensures visual consistency
  let referenceResult: { base64: string } | undefined;

  try {
    for (let ti = 0; ti < taggedPoses.length; ti++) {
      const { poseIdx } = taggedPoses[ti]!;
      const pose = poses[poseIdx]!;
      const progress = ti / taggedPoses.length;
      updatePixelLabProgress(modalEl, progress, `Inpainting pose ${ti + 1}/${taggedPoses.length}...`);

      // Step 1: Render original pose → image + mask
      const { image, mask, width, height } = renderPoseForInpaint(gfxRom, pose, colors);

      const size = { width, height };
      const inpaintingImage = imageDataToBase64PNG(image);
      const maskImage = imageDataToBase64PNG(mask);

      // Step 2: Resize reference to match this pose's dimensions (if needed)
      let initImageForPose = referenceResult;
      if (referenceResult) {
        initImageForPose = await resizeBase64Image(referenceResult.base64, width, height);
      }

      // Call /inpaint (pass resized reference from first pose for consistency)
      const resultBlob = await client.inpaint({
        description: desc,
        size,
        inpaintingImage,
        maskImage,
        colorImage,
        initImage: initImageForPose,
        initImageStrength: initImageForPose ? 400 : undefined,
        direction: 'east',
      });

      // Save first result as reference for subsequent poses
      if (!referenceResult) {
        const b64 = await blobToBase64(resultBlob);
        referenceResult = { base64: b64 };
      }

      // Step 3: Quantize result to palette indices
      const { indexed } = await quantizeInpaintResult(resultBlob, colors);

      // Step 4: Write pixels back to the same tiles
      for (const tile of pose.tiles) {
        if (tile.palette !== palIdx) continue;

        for (let ty = 0; ty < 16; ty++) {
          for (let tx = 0; tx < 16; tx++) {
            const srcX = tile.flipX ? 15 - tx : tx;
            const srcY = tile.flipY ? 15 - ty : ty;

            const px = tile.relX + tx;
            const py = tile.relY + ty;
            if (px < 0 || px >= width || py < 0 || py >= height) continue;

            const ci = indexed[py * width + px]!;
            writePixel(gfxRom, tile.mappedCode, srcX, srcY, ci);
          }
        }
      }

      posesWritten++;
    }

    // Force re-render
    emulator.rerender();
    emulator.getRomStore()?.onModified?.();
    onRefresh();

    updatePixelLabProgress(modalEl, 1.0, `Done! ${posesWritten} poses replaced`);
    showToast(`${posesWritten} poses replaced via PixelLab`, true);

    setTimeout(() => modalEl.remove(), 1500);

  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    updatePixelLabProgress(modalEl, 0, `Error: ${msg}`);
    showToast(`PixelLab error: ${msg}`, false);
    console.error('[PixelLab]', err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  return uint8ToBase64(new Uint8Array(buf));
}

/** Resize a base64 PNG to target dimensions via canvas */
async function resizeBase64Image(b64: string, w: number, h: number): Promise<{ base64: string }> {
  const blob = new Blob(
    [Uint8Array.from(atob(b64), c => c.charCodeAt(0))],
    { type: 'image/png' },
  );
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/png');
  return { base64: dataUrl.split(',')[1]! };
}
