/**
 * PixelLab API types for Sprixe integration.
 * Based on PixelLab OpenAPI spec (https://api.pixellab.ai/v1/openapi.json).
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PixelLabConfig {
  apiKey: string;
  apiUrl: string; // default: https://api.pixellab.ai/v1
}

// ---------------------------------------------------------------------------
// Animation template IDs (49 humanoid templates)
// ---------------------------------------------------------------------------

export const ANIMATION_TEMPLATES = [
  'backflip',
  'breathing-idle',
  'cross-punch',
  'crouched-walking',
  'crouching',
  'drinking',
  'falling-back-death',
  'fight-stance-idle-8-frames',
  'fireball',
  'flying-kick',
  'front-flip',
  'getting-up',
  'high-kick',
  'hurricane-kick',
  'jumping-1',
  'jumping-2',
  'lead-jab',
  'leg-sweep',
  'picking-up',
  'pull-heavy-object',
  'pushing',
  'roundhouse-kick',
  'running-4-frames',
  'running-6-frames',
  'running-8-frames',
  'running-jump',
  'running-slide',
  'sad-walk',
  'scary-walk',
  'surprise-uppercut',
  'taking-punch',
  'throw-object',
  'two-footed-jump',
  'walk',
  'walk-1',
  'walk-2',
  'walking',
  'walking-10',
  'walking-2',
  'walking-3',
  'walking-4',
  'walking-4-frames',
  'walking-5',
  'walking-6',
  'walking-6-frames',
  'walking-7',
  'walking-8',
  'walking-8-frames',
  'walking-9',
] as const;

export type AnimationTemplateId = typeof ANIMATION_TEMPLATES[number];

// Human-readable labels for the UI dropdown
export const ANIMATION_LABELS: Record<AnimationTemplateId, string> = {
  'backflip': 'Backflip',
  'breathing-idle': 'Idle (breathing)',
  'cross-punch': 'Cross Punch',
  'crouched-walking': 'Crouch Walk',
  'crouching': 'Crouch',
  'drinking': 'Drinking',
  'falling-back-death': 'KO (fall back)',
  'fight-stance-idle-8-frames': 'Fight Stance Idle',
  'fireball': 'Fireball',
  'flying-kick': 'Flying Kick',
  'front-flip': 'Front Flip',
  'getting-up': 'Get Up',
  'high-kick': 'High Kick',
  'hurricane-kick': 'Hurricane Kick',
  'jumping-1': 'Jump',
  'jumping-2': 'Jump (alt)',
  'lead-jab': 'Jab',
  'leg-sweep': 'Leg Sweep',
  'picking-up': 'Pick Up',
  'pull-heavy-object': 'Pull Object',
  'pushing': 'Push',
  'roundhouse-kick': 'Roundhouse',
  'running-4-frames': 'Run (4f)',
  'running-6-frames': 'Run (6f)',
  'running-8-frames': 'Run (8f)',
  'running-jump': 'Running Jump',
  'running-slide': 'Slide',
  'sad-walk': 'Sad Walk',
  'scary-walk': 'Scary Walk',
  'surprise-uppercut': 'Uppercut',
  'taking-punch': 'Hit Stun',
  'throw-object': 'Throw',
  'two-footed-jump': 'Two-Foot Jump',
  'walk': 'Walk',
  'walk-1': 'Walk (v1)',
  'walk-2': 'Walk (v2)',
  'walking': 'Walking',
  'walking-10': 'Walking (10f)',
  'walking-2': 'Walking (v2)',
  'walking-3': 'Walking (v3)',
  'walking-4': 'Walking (v4)',
  'walking-4-frames': 'Walking (4f)',
  'walking-5': 'Walking (v5)',
  'walking-6': 'Walking (v6)',
  'walking-6-frames': 'Walking (6f)',
  'walking-7': 'Walking (v7)',
  'walking-8': 'Walking (v8)',
  'walking-8-frames': 'Walking (8f)',
  'walking-9': 'Walking (v9)',
};

// ---------------------------------------------------------------------------
// Pose tag — links a captured pose to a PixelLab animation frame
// ---------------------------------------------------------------------------

export interface PoseAnimTag {
  template: AnimationTemplateId;
  frame: number; // 0-based frame index within the animation
}

// ---------------------------------------------------------------------------
// API request/response types
// ---------------------------------------------------------------------------

export interface Base64Image {
  base64: string; // PNG base64 (no data: prefix)
}

export interface ImageSize {
  width: number;
  height: number;
}

/** /generate-image-pixflux */
export interface GenerateImageRequest {
  description: string;
  image_size: ImageSize;
  text_guidance_scale?: number;
  outline?: 'single color black outline' | 'single color outline' | 'selective outline' | 'lineless';
  shading?: 'flat shading' | 'basic shading' | 'medium shading' | 'detailed shading';
  detail?: 'low detail' | 'medium detail' | 'highly detailed';
  view?: 'side' | 'low top-down' | 'high top-down';
  direction?: 'north' | 'north-east' | 'east' | 'south-east' | 'south' | 'south-west' | 'west' | 'north-west';
  no_background?: boolean;
  init_image?: Base64Image;
  init_image_strength?: number;
  color_image?: Base64Image;
  seed?: number;
}

/** /animate-with-text */
export interface AnimateWithTextRequest {
  description: string;
  action: string;
  image_size: ImageSize;
  text_guidance_scale?: number;
  image_guidance_scale?: number;
  n_frames: number; // 2-20
  start_frame_index?: number;
  view?: 'side' | 'low top-down' | 'high top-down';
  direction?: 'north' | 'north-east' | 'east' | 'south-east' | 'south' | 'south-west' | 'west' | 'north-west';
  reference_image: Base64Image;
  init_images?: Base64Image[];
  init_image_strength?: number;
  color_image?: Base64Image;
  seed?: number;
}

/** /estimate-skeleton */
export interface EstimateSkeletonRequest {
  image: Base64Image;
}

export interface SkeletonKeypoint {
  x: number;
  y: number;
  label: string;
  z_index?: number;
}

/** API returns PNG as base64 or binary blob */
export interface GenerateImageResponse {
  image: Base64Image;
}

export interface AnimateResponse {
  images: Base64Image[];
}
