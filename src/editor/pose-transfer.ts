/**
 * Pose Transfer — generate images of a person in sprite poses via fal.ai.
 *
 * Strategy:
 * 1. Use fal-ai/dwpose to auto-detect skeleton on user's photo
 * 2. Use fal-ai/z-image/turbo/controlnet with OpenPose skeleton to generate posed images
 *
 * The skeleton from sprite poses is rendered as an OpenPose PNG and used as control image.
 * The user's photo is described in the prompt for identity preservation.
 */

import { fal } from '@fal-ai/client';
import type { Skeleton } from './pose-skeleton';
import { renderSkeletonPng } from './pose-skeleton';

// ---------------------------------------------------------------------------
// API Key management
// ---------------------------------------------------------------------------

const FAL_KEY_STORAGE = 'romstudio-fal-api-key';

export function getFalApiKey(): string {
  return localStorage.getItem(FAL_KEY_STORAGE) ?? '';
}

export function setFalApiKey(key: string): void {
  localStorage.setItem(FAL_KEY_STORAGE, key);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PoseTransferResult {
  imageUrl: string;
  poseIndex: number;
}

// ---------------------------------------------------------------------------
// Auto-detect skeleton on user's photo via fal-ai/dwpose
// ---------------------------------------------------------------------------

/**
 * Detect pose keypoints on the user's photo using DWPose.
 * Returns the OpenPose skeleton image URL (for reference/debug).
 */
export async function detectUserPose(photoDataUrl: string): Promise<string> {
  const apiKey = getFalApiKey();
  if (!apiKey) throw new Error('No fal.ai API key configured');
  fal.config({ credentials: apiKey });

  const result = await fal.subscribe('fal-ai/dwpose', {
    input: {
      image_url: photoDataUrl,
      draw_mode: 'body-pose',
    },
    logs: true,
  });

  const data = result.data as { image?: { url: string } };
  if (!data.image?.url) throw new Error('DWPose: no result image');
  return data.image.url;
}

// ---------------------------------------------------------------------------
// Generate a posed image via ControlNet + OpenPose skeleton
// ---------------------------------------------------------------------------

/**
 * Generate an image in a specific pose using the OpenPose skeleton as control.
 *
 * @param personPhotoDataUrl The user's photo (for the prompt / IP adapter)
 * @param skeleton Target pose skeleton (from sprite annotation)
 * @param spriteW Sprite width in CPS1 pixels
 * @param spriteH Sprite height in CPS1 pixels
 * @param poseIndex Index of this pose (for tracking)
 */
export async function generatePosedImage(
  personPhotoDataUrl: string,
  skeleton: Skeleton,
  spriteW: number,
  spriteH: number,
  poseIndex: number,
): Promise<PoseTransferResult> {
  const apiKey = getFalApiKey();
  if (!apiKey) throw new Error('No fal.ai API key configured');
  fal.config({ credentials: apiKey });

  // Render skeleton as OpenPose-format PNG (512x768, colored bones on black bg)
  const skeletonImg = renderSkeletonPng(skeleton, spriteW, spriteH, 512, 768);
  const skeletonDataUrl = imageDataToDataUrl(skeletonImg);

  const result = await fal.subscribe('fal-ai/z-image/turbo/controlnet', {
    input: {
      prompt: 'full body photo of a person, same person same clothes, white background, high quality, sharp details',
      image_url: skeletonDataUrl,
      person_image_url: personPhotoDataUrl,
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === 'IN_PROGRESS') {
        for (const log of update.logs) {
          console.log(`[fal.ai pose ${poseIndex}]`, log.message);
        }
      }
    },
  });

  const data = result.data as { images?: Array<{ url: string }>; image?: { url: string } };
  const imageUrl = data.images?.[0]?.url ?? data.image?.url;
  if (!imageUrl) throw new Error(`No image returned for pose ${poseIndex}`);

  return { imageUrl, poseIndex };
}

/**
 * Generate posed images for all poses sequentially.
 */
export async function generateAllPoses(
  personPhotoDataUrl: string,
  skeletons: Map<number, Skeleton>,
  spriteW: number,
  spriteH: number,
  onProgress: (completed: number, total: number, result: PoseTransferResult) => void,
): Promise<PoseTransferResult[]> {
  const entries = [...skeletons.entries()];
  const total = entries.length;
  const results: PoseTransferResult[] = [];

  for (let i = 0; i < entries.length; i++) {
    const [poseIndex, skeleton] = entries[i]!;
    const result = await generatePosedImage(personPhotoDataUrl, skeleton, spriteW, spriteH, poseIndex);
    results.push(result);
    onProgress(i + 1, total, result);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function imageDataToDataUrl(img: ImageData): string {
  const cvs = document.createElement('canvas');
  cvs.width = img.width;
  cvs.height = img.height;
  cvs.getContext('2d')!.putImageData(img, 0, 0);
  return cvs.toDataURL('image/png');
}
