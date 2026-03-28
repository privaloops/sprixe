/**
 * Pose Skeleton — keypoint annotation, auto-propagation, and OpenPose rendering.
 *
 * 17-keypoint skeleton (OpenPose standard) for CPS1 sprite pose transfer.
 * Propagation uses color-based template matching between sprite poses.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Keypoint {
  x: number;
  y: number;
  name: string;
  confidence?: number;
}

export type Skeleton = Keypoint[];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const KEYPOINT_NAMES = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
] as const;

/** Pairs of keypoint indices to draw as bones. */
export const SKELETON_CONNECTIONS: [number, number][] = [
  [0, 1], [0, 2], [1, 3], [2, 4],             // head
  [5, 6],                                       // shoulders
  [5, 7], [7, 9], [6, 8], [8, 10],            // arms
  [5, 11], [6, 12], [11, 12],                  // torso
  [11, 13], [13, 15], [12, 14], [14, 16],      // legs
];

/** OpenPose-style colors for each bone connection. */
const BONE_COLORS = [
  '#FF0000', '#FF5500', '#FFAA00', '#FFFF00',  // head
  '#AAFF00',                                     // shoulders
  '#55FF00', '#00FF00', '#00FF55', '#00FFAA',   // arms
  '#00FFFF', '#00AAFF', '#0055FF',              // torso
  '#0000FF', '#5500FF', '#AA00FF', '#FF00FF',   // legs
];

const KEYPOINT_RADIUS = 3;

// ---------------------------------------------------------------------------
// Render skeleton overlay on a canvas context
// ---------------------------------------------------------------------------

/**
 * Draw a skeleton overlay on a 2D canvas context.
 * Coordinates are in CPS1 sprite pixels (not CSS pixels).
 */
export function renderSkeletonOverlay(
  ctx: CanvasRenderingContext2D,
  skeleton: Skeleton,
  highlightIndex = -1,
): void {
  // Draw bones (thin lines)
  ctx.lineWidth = 0.5;
  for (let i = 0; i < SKELETON_CONNECTIONS.length; i++) {
    const [a, b] = SKELETON_CONNECTIONS[i]!;
    const ka = skeleton[a];
    const kb = skeleton[b];
    if (!ka || !kb) continue;

    ctx.strokeStyle = BONE_COLORS[i] ?? '#fff';
    ctx.beginPath();
    ctx.moveTo(ka.x, ka.y);
    ctx.lineTo(kb.x, kb.y);
    ctx.stroke();
  }

  // Draw keypoints as small 2x2 squares (1 CPS1 pixel = visible at any zoom)
  for (let i = 0; i < skeleton.length; i++) {
    const kp = skeleton[i]!;
    const isHighlight = i === highlightIndex;
    ctx.fillStyle = isHighlight ? '#ff1a50' : '#00ff66';
    ctx.fillRect(Math.round(kp.x) - 1, Math.round(kp.y) - 1, 2, 2);
  }
}

/**
 * Render an OpenPose-format skeleton PNG as ImageData (for API input).
 * Black background, colored bones and white keypoint circles.
 */
export function renderSkeletonPng(
  skeleton: Skeleton,
  width: number,
  height: number,
  outputWidth = 512,
  outputHeight = 768,
): ImageData {
  const cvs = document.createElement('canvas');
  cvs.width = outputWidth;
  cvs.height = outputHeight;
  const ctx = cvs.getContext('2d')!;

  // Black background
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, outputWidth, outputHeight);

  // Scale skeleton coords from sprite space to output space
  const scaleX = outputWidth / width;
  const scaleY = outputHeight / height;

  // Draw bones
  ctx.lineWidth = 4;
  for (let i = 0; i < SKELETON_CONNECTIONS.length; i++) {
    const [a, b] = SKELETON_CONNECTIONS[i]!;
    const ka = skeleton[a];
    const kb = skeleton[b];
    if (!ka || !kb) continue;

    ctx.strokeStyle = BONE_COLORS[i] ?? '#fff';
    ctx.beginPath();
    ctx.moveTo(ka.x * scaleX, ka.y * scaleY);
    ctx.lineTo(kb.x * scaleX, kb.y * scaleY);
    ctx.stroke();
  }

  // Draw keypoints
  for (const kp of skeleton) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(kp.x * scaleX, kp.y * scaleY, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  return ctx.getImageData(0, 0, outputWidth, outputHeight);
}

// ---------------------------------------------------------------------------
// Auto-propagation — template matching between poses
// ---------------------------------------------------------------------------

/**
 * Propagate keypoints from a base pose to a target pose using
 * color-based template matching on sprite pixel data.
 *
 * @param baseSkeleton Keypoints from the annotated base pose
 * @param basePixels Palette-indexed pixel array of the base pose (w*h)
 * @param targetPixels Palette-indexed pixel array of the target pose (w*h)
 * @param baseW Width of the base pose
 * @param baseH Height of the base pose
 * @param targetW Width of the target pose
 * @param targetH Height of the target pose
 */
export function propagateKeypoints(
  baseSkeleton: Skeleton,
  basePixels: Uint8Array,
  targetPixels: Uint8Array,
  baseW: number,
  baseH: number,
  targetW: number,
  targetH: number,
): Skeleton {
  const PATCH_RADIUS = 3; // 7x7 patch
  const result: Skeleton = [];

  for (const kp of baseSkeleton) {
    // Extract color patch around keypoint in base pose
    const basePatch = extractPatch(basePixels, baseW, baseH, Math.round(kp.x), Math.round(kp.y), PATCH_RADIUS);

    // Search for best matching position in target pose
    let bestX = Math.round(kp.x * targetW / baseW); // initial guess: scaled position
    let bestY = Math.round(kp.y * targetH / baseH);
    let bestScore = -1;

    // Search window: ±50% of pose dimensions from the scaled position
    const searchW = Math.ceil(targetW * 0.5);
    const searchH = Math.ceil(targetH * 0.5);
    const startX = Math.max(0, bestX - searchW);
    const startY = Math.max(0, bestY - searchH);
    const endX = Math.min(targetW - 1, bestX + searchW);
    const endY = Math.min(targetH - 1, bestY + searchH);

    for (let ty = startY; ty <= endY; ty++) {
      for (let tx = startX; tx <= endX; tx++) {
        const targetPatch = extractPatch(targetPixels, targetW, targetH, tx, ty, PATCH_RADIUS);
        const score = patchSimilarity(basePatch, targetPatch);
        if (score > bestScore) {
          bestScore = score;
          bestX = tx;
          bestY = ty;
        }
      }
    }

    result.push({
      x: bestX,
      y: bestY,
      name: kp.name,
      confidence: bestScore,
    });
  }

  // Post-process: apply segment length constraints from base skeleton
  applySegmentConstraints(result, baseSkeleton, baseW, baseH, targetW, targetH);

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a (2r+1)x(2r+1) patch of palette indices centered at (cx, cy). */
function extractPatch(
  pixels: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
): Uint8Array {
  const size = radius * 2 + 1;
  const patch = new Uint8Array(size * size);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      const pi = (dy + radius) * size + (dx + radius);
      if (x >= 0 && x < w && y >= 0 && y < h) {
        patch[pi] = pixels[y * w + x]!;
      }
      // Out of bounds → 0 (transparent), which is fine
    }
  }
  return patch;
}

/** Compare two patches by counting matching non-transparent palette indices. */
function patchSimilarity(a: Uint8Array, b: Uint8Array): number {
  let matches = 0;
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0 && b[i] === 0) continue; // both transparent, skip
    total++;
    if (a[i] === b[i]) matches++;
  }
  return total > 0 ? matches / total : 0;
}

/** Nudge propagated keypoints to preserve bone lengths from the base skeleton. */
function applySegmentConstraints(
  target: Skeleton,
  base: Skeleton,
  baseW: number,
  baseH: number,
  targetW: number,
  targetH: number,
): void {
  const scaleX = targetW / baseW;
  const scaleY = targetH / baseH;

  for (const [a, b] of SKELETON_CONNECTIONS) {
    const baseA = base[a];
    const baseB = base[b];
    const targetA = target[a];
    const targetB = target[b];
    if (!baseA || !baseB || !targetA || !targetB) continue;

    // Expected length (scaled from base)
    const baseDx = (baseB.x - baseA.x) * scaleX;
    const baseDy = (baseB.y - baseA.y) * scaleY;
    const expectedLen = Math.sqrt(baseDx * baseDx + baseDy * baseDy);
    if (expectedLen < 1) continue;

    // Actual length in target
    const dx = targetB.x - targetA.x;
    const dy = targetB.y - targetA.y;
    const actualLen = Math.sqrt(dx * dx + dy * dy);
    if (actualLen < 1) continue;

    // If length deviates by more than 30%, nudge endpoint B toward correct length
    const ratio = expectedLen / actualLen;
    if (Math.abs(ratio - 1) > 0.3) {
      const midX = (targetA.x + targetB.x) / 2;
      const midY = (targetA.y + targetB.y) / 2;
      const halfLen = expectedLen / 2;
      const angle = Math.atan2(dy, dx);
      targetA.x = midX - Math.cos(angle) * halfLen;
      targetA.y = midY - Math.sin(angle) * halfLen;
      targetB.x = midX + Math.cos(angle) * halfLen;
      targetB.y = midY + Math.sin(angle) * halfLen;
    }
  }
}
