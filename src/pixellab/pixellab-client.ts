/**
 * PixelLab API client for Sprixe.
 * Uses bitforge + skeleton endpoints for quality character generation.
 *
 * Pipeline:
 *   1. estimate-skeleton → extract keypoints from reference pose
 *   2. generate-image-bitforge → generate character with skeleton + palette
 *   3. animate-with-skeleton → animate with per-frame keypoints
 *
 * API docs: https://api.pixellab.ai/v1/docs
 */

import type {
  PixelLabConfig,
  Base64Image,
  ImageSize,
  SkeletonKeypoint,
} from './pixellab-types';

const DEFAULT_API_URL = 'https://api.pixellab.ai/v1';

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class PixelLabClient {
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(config: PixelLabConfig) {
    this.apiUrl = config.apiUrl || DEFAULT_API_URL;
    this.apiKey = config.apiKey;
  }

  // -------------------------------------------------------------------------
  // Extract skeleton keypoints from an image
  // -------------------------------------------------------------------------

  async estimateSkeleton(image: Base64Image): Promise<SkeletonKeypoint[]> {
    const res = await this.postJSON('/estimate-skeleton', { image });
    return res.skeleton_keypoints ?? res.keypoints ?? res;
  }

  // -------------------------------------------------------------------------
  // Generate character with bitforge (skeleton-guided, high quality)
  // -------------------------------------------------------------------------

  async generateCharacter(opts: {
    description: string;
    size: ImageSize;
    skeletonKeypoints?: SkeletonKeypoint[];
    skeletonGuidanceScale?: number;
    colorImage?: Base64Image;
    /** Reference photo for style/face */
    initImage?: Base64Image;
    initImageStrength?: number;
    direction?: string;
    seed?: number;
  }): Promise<Blob> {
    const body: Record<string, unknown> = {
      description: opts.description,
      image_size: opts.size,
      view: 'side',
      direction: opts.direction ?? 'east',
      no_background: true,
      outline: 'single color black outline',
      shading: 'medium shading',
      detail: 'highly detailed',
      text_guidance_scale: 8,
      coverage_percentage: 80,
    };
    if (opts.skeletonKeypoints) {
      body.skeleton_keypoints = opts.skeletonKeypoints;
      body.skeleton_guidance_scale = opts.skeletonGuidanceScale ?? 1.0;
    }
    if (opts.colorImage) body.color_image = opts.colorImage;
    if (opts.initImage) {
      body.init_image = opts.initImage;
      body.init_image_strength = opts.initImageStrength ?? 300;
    }
    if (opts.seed !== undefined) body.seed = opts.seed;

    return this.postImage('/generate-image-bitforge', body);
  }

  // -------------------------------------------------------------------------
  // Animate with skeleton keypoints (per-frame poses)
  // -------------------------------------------------------------------------

  async animateWithSkeleton(opts: {
    referenceImage: Base64Image;
    size: ImageSize;
    /** Array of keypoint arrays — one per frame (4 frames) */
    skeletonKeypoints: SkeletonKeypoint[][];
    colorImage?: Base64Image;
    direction?: string;
    guidanceScale?: number;
    seed?: number;
  }): Promise<Blob[]> {
    const body: Record<string, unknown> = {
      reference_image: opts.referenceImage,
      image_size: opts.size,
      skeleton_keypoints: opts.skeletonKeypoints,
      view: 'side',
      direction: opts.direction ?? 'east',
      guidance_scale: opts.guidanceScale ?? 4.0,
    };
    if (opts.colorImage) body.color_image = opts.colorImage;
    if (opts.seed !== undefined) body.seed = opts.seed;

    return this.postImages('/animate-with-skeleton', body);
  }

  // -------------------------------------------------------------------------
  // Inpaint — regenerate within a mask, constrained to tile layout
  // -------------------------------------------------------------------------

  async inpaint(opts: {
    description: string;
    size: ImageSize;
    /** The original sprite image (composed from tiles) */
    inpaintingImage: Base64Image;
    /** White = area to regenerate, black = keep */
    maskImage: Base64Image;
    colorImage?: Base64Image;
    /** Reference image from first pose for visual consistency */
    initImage?: Base64Image;
    initImageStrength?: number;
    direction?: string;
    seed?: number;
  }): Promise<Blob> {
    const body: Record<string, unknown> = {
      description: opts.description,
      image_size: opts.size,
      inpainting_image: opts.inpaintingImage,
      mask_image: opts.maskImage,
      view: 'side',
      direction: opts.direction ?? 'east',
      no_background: true,
      outline: 'single color black outline',
      shading: 'medium shading',
      detail: 'highly detailed',
      text_guidance_scale: 3,
    };
    if (opts.colorImage) body.color_image = opts.colorImage;
    if (opts.initImage) {
      body.init_image = opts.initImage;
      body.init_image_strength = opts.initImageStrength ?? 400;
    }
    if (opts.seed !== undefined) body.seed = opts.seed;

    return this.postImage('/inpaint', body);
  }

  // -------------------------------------------------------------------------
  // Animate with text (fallback when no skeleton available)
  // -------------------------------------------------------------------------

  async animateWithText(opts: {
    description: string;
    action: string;
    nFrames: number;
    referenceImage: Base64Image;
    size: ImageSize;
    colorImage?: Base64Image;
    direction?: string;
    seed?: number;
  }): Promise<Blob[]> {
    const body: Record<string, unknown> = {
      description: opts.description,
      action: opts.action,
      n_frames: opts.nFrames,
      reference_image: opts.referenceImage,
      image_size: opts.size,
      view: 'side',
      direction: opts.direction ?? 'east',
      text_guidance_scale: 8,
      image_guidance_scale: 1.4,
    };
    if (opts.colorImage) body.color_image = opts.colorImage;
    if (opts.seed !== undefined) body.seed = opts.seed;

    return this.postImages('/animate-with-text', body);
  }

  // -------------------------------------------------------------------------
  // HTTP helpers
  // -------------------------------------------------------------------------

  /** POST → parsed JSON response */
  private async postJSON(endpoint: string, body: object): Promise<any> {
    const res = await fetch(`${this.apiUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PixelLab ${endpoint}: ${res.status} — ${text}`);
    }
    return res.json();
  }

  /** POST → single image Blob (from { image: { base64: "..." } }) */
  private async postImage(endpoint: string, body: object): Promise<Blob> {
    const json = await this.postJSON(endpoint, body);
    return base64ResponseToBlob(json.image.base64);
  }

  /** POST → multiple image Blobs (from { images: [...] } or { output_images: [...] }) */
  private async postImages(endpoint: string, body: object): Promise<Blob[]> {
    const json = await this.postJSON(endpoint, body);
    const images = json.output_images ?? json.images ?? [json.image];
    return images.map((img: any) => base64ResponseToBlob(img.base64));
  }
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

/** Convert "data:image/png;base64,..." or raw base64 to Blob */
function base64ResponseToBlob(b64: string): Blob {
  const raw = b64.includes(',') ? b64.split(',')[1]! : b64;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

// ---------------------------------------------------------------------------
// Palette → color_image helper
// ---------------------------------------------------------------------------

/**
 * Build a small PNG containing the 16 palette colors as a 16×1 strip.
 * PixelLab uses this as `color_image` to constrain generation colors.
 */
export function paletteToColorImage(
  colors: Array<[number, number, number]>,
): Base64Image {
  const w = 16, h = 1;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < 16; i++) {
    const [r, g, b] = colors[i] ?? [0, 0, 0];
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  const png = encodeMinimalPNG(w, h, rgba);
  return { base64: uint8ToBase64(png) };
}

/**
 * Convert an ImageData (canvas) to a Base64Image for the API.
 */
export function imageDataToBase64(img: ImageData): Base64Image {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(img, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');
  return { base64: dataUrl.split(',')[1]! };
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder (browser, no deps)
// ---------------------------------------------------------------------------

function encodeMinimalPNG(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (1 + w * 4) + 1);
  }
  const deflated = deflateSync(raw);
  const chunks: Uint8Array[] = [];
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, w, false);
  new DataView(ihdr.buffer).setUint32(4, h, false);
  ihdr[8] = 8; ihdr[9] = 6;
  chunks.push(buildPNGChunk('IHDR', ihdr));
  chunks.push(buildPNGChunk('IDAT', deflated));
  chunks.push(buildPNGChunk('IEND', new Uint8Array(0)));
  let total = sig.length;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  out.set(sig, 0);
  let off = sig.length;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function buildPNGChunk(type: string, data: Uint8Array): Uint8Array {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length, false);
  const typeBytes = new TextEncoder().encode(type);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  const crcVal = crc32(crcInput);
  const crcBytes = new Uint8Array(4);
  new DataView(crcBytes.buffer).setUint32(0, crcVal >>> 0, false);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  chunk.set(len, 0);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  chunk.set(crcBytes, 8 + data.length);
  return chunk;
}

function crc32(buf: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
  }
  return c ^ 0xFFFFFFFF;
}

function deflateSync(data: Uint8Array): Uint8Array {
  const maxBlock = 65535;
  const blocks: Uint8Array[] = [];
  let offset = 0;
  while (offset < data.length) {
    const remaining = data.length - offset;
    const blockSize = Math.min(remaining, maxBlock);
    const isFinal = offset + blockSize >= data.length;
    const header = new Uint8Array(5);
    header[0] = isFinal ? 0x01 : 0x00;
    header[1] = blockSize & 0xFF;
    header[2] = (blockSize >> 8) & 0xFF;
    header[3] = ~blockSize & 0xFF;
    header[4] = (~blockSize >> 8) & 0xFF;
    blocks.push(header);
    blocks.push(data.subarray(offset, offset + blockSize));
    offset += blockSize;
  }
  let total = 2;
  for (const b of blocks) total += b.length;
  total += 4;
  const out = new Uint8Array(total);
  out[0] = 0x78; out[1] = 0x01;
  let pos = 2;
  for (const b of blocks) { out.set(b, pos); pos += b.length; }
  const adler = adler32(data);
  out[pos] = (adler >> 24) & 0xFF;
  out[pos + 1] = (adler >> 16) & 0xFF;
  out[pos + 2] = (adler >> 8) & 0xFF;
  out[pos + 3] = adler & 0xFF;
  return out;
}

function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return (b << 16) | a;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}
