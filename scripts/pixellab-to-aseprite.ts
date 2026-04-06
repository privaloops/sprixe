/**
 * PixelLab → Aseprite converter (for Sprixe ROM import)
 * Reads PixelLab extracted ZIP + original Ryu aseprite manifest,
 * scales PixelLab sprites to Ryu's size, splits into 16x16 tiles,
 * and writes a .aseprite compatible with Sprixe's import pipeline.
 *
 * Usage: npx tsx scripts/pixellab-to-aseprite.ts
 */

import { writeFileSync, readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { writeAseprite, type AsepriteFrame, type AsepritePaletteEntry } from '../src/editor/aseprite-writer';
import { readAseprite } from '../src/editor/aseprite-reader';
import * as zlib from 'zlib';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ZIP_DIR = '/Users/privaloops/Downloads/bigman_full';
const ORIGINAL_ASE = '/Users/privaloops/Downloads/sf2hf_pal1_74poses.aseprite';
const DIRECTION = 'east';

// Ryu's palette (from sf2hf_pal1_74poses.aseprite)
const RYU_PALETTE: AsepritePaletteEntry[] = [
  { r: 17, g: 17, b: 17, a: 255 },
  { r: 255, g: 221, b: 153, a: 255 },
  { r: 255, g: 187, b: 136, a: 255 },
  { r: 238, g: 153, b: 119, a: 255 },
  { r: 204, g: 136, b: 102, a: 255 },
  { r: 153, g: 102, b: 85, a: 255 },
  { r: 102, g: 68, b: 51, a: 255 },
  { r: 187, g: 0, b: 0, a: 255 },
  { r: 255, g: 255, b: 255, a: 255 },
  { r: 238, g: 238, b: 204, a: 255 },
  { r: 221, g: 204, b: 170, a: 255 },
  { r: 187, g: 170, b: 136, a: 255 },
  { r: 170, g: 136, b: 119, a: 255 },
  { r: 119, g: 102, b: 85, a: 255 },
  { r: 255, g: 0, b: 0, a: 255 },
  { r: 0, g: 0, b: 0, a: 0 },
];

// ---------------------------------------------------------------------------
// PNG decoder (minimal, handles RGBA 8-bit, filter types 0-4)
// ---------------------------------------------------------------------------

interface DecodedPNG { width: number; height: number; pixels: Uint8Array }

function decodePNG(buffer: Buffer): DecodedPNG {
  let pos = 8;
  let width = 0, height = 0;
  const idatChunks: Buffer[] = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.subarray(pos + 4, pos + 8).toString('ascii');
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    else if (type === 'IDAT') { idatChunks.push(Buffer.from(data)); }
    pos += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * 4;
  const pixels = new Uint8Array(width * height * 4);
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const fb = raw[y * (stride + 1)]!;
    const rowStart = y * (stride + 1) + 1;
    const row = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const rawByte = raw[rowStart + i]!;
      const a = i >= 4 ? row[i - 4]! : 0;
      const b = y > 0 ? rows[y - 1]![i]! : 0;
      const c = (y > 0 && i >= 4) ? rows[y - 1]![i - 4]! : 0;
      switch (fb) {
        case 0: row[i] = rawByte; break;
        case 1: row[i] = (rawByte + a) & 0xFF; break;
        case 2: row[i] = (rawByte + b) & 0xFF; break;
        case 3: row[i] = (rawByte + ((a + b) >> 1)) & 0xFF; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          row[i] = (rawByte + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c))) & 0xFF;
          break;
        }
        default: row[i] = rawByte;
      }
    }
    rows.push(row);
    pixels.set(row, y * stride);
  }
  return { width, height, pixels };
}

// ---------------------------------------------------------------------------
// Crop — find bounding box of non-transparent pixels
// ---------------------------------------------------------------------------

interface BBox { x: number; y: number; w: number; h: number }

function findBBox(pixels: Uint8Array, w: number, h: number): BBox {
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[(y * w + x) * 4 + 3]! > 128) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// ---------------------------------------------------------------------------
// Scale RGBA image (nearest neighbor — pixel art friendly)
// ---------------------------------------------------------------------------

function scaleRGBA(
  src: Uint8Array, srcW: number, srcH: number,
  dstW: number, dstH: number,
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.floor(y * srcH / dstH);
    for (let x = 0; x < dstW; x++) {
      const sx = Math.floor(x * srcW / dstW);
      const si = (sy * srcW + sx) * 4;
      const di = (y * dstW + x) * 4;
      dst[di] = src[si]!;
      dst[di + 1] = src[si + 1]!;
      dst[di + 2] = src[si + 2]!;
      dst[di + 3] = src[si + 3]!;
    }
  }
  return dst;
}

// ---------------------------------------------------------------------------
// Map RGBA pixel to nearest palette index
// ---------------------------------------------------------------------------

function rgbaToPaletteIndex(r: number, g: number, b: number, a: number): number {
  if (a < 128) return 15; // transparent
  let bestIdx = 0, bestDist = Infinity;
  for (let c = 0; c < 15; c++) {
    const pe = RYU_PALETTE[c]!;
    const dr = r - pe.r, dg = g - pe.g, db = b - pe.b;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) { bestDist = dist; bestIdx = c; }
  }
  return bestIdx;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('PixelLab → Aseprite converter (Sprixe-compatible)');

  // Step 1: Read original Ryu manifest
  const origBuf = readFileSync(ORIGINAL_ASE);
  const origAse = readAseprite(origBuf.buffer);
  const manifest = origAse.manifest as any;
  const frameW = manifest.frameSize.w as number; // 128
  const frameH = manifest.frameSize.h as number; // 128
  console.log(`Original: ${manifest.frames.length} poses, ${frameW}x${frameH}`);

  // Step 2: Load all PixelLab PNGs (east direction), crop, scale
  interface ScaledFrame { indexed: Uint8Array; label: string }
  const pixelLabFrames: ScaledFrame[] = [];

  // Collect all PNG paths
  const pngPaths: { path: string; label: string }[] = [];

  // Rotation
  const rotPath = join(ZIP_DIR, 'rotations', `${DIRECTION}.png`);
  if (existsSync(rotPath)) pngPaths.push({ path: rotPath, label: 'stand' });

  // Animations
  const animDir = join(ZIP_DIR, 'animations');
  if (existsSync(animDir)) {
    for (const anim of readdirSync(animDir).sort()) {
      const dirPath = join(animDir, anim, DIRECTION);
      if (!existsSync(dirPath)) continue;
      for (const ff of readdirSync(dirPath).filter(f => f.endsWith('.png')).sort()) {
        pngPaths.push({ path: join(dirPath, ff), label: `${anim}_${ff.replace('.png', '')}` });
      }
    }
  }

  console.log(`PixelLab frames found: ${pngPaths.length}`);

  // Find global crop box across all PixelLab frames
  const allPngs = pngPaths.map(p => ({ ...p, png: decodePNG(readFileSync(p.path)) }));
  let gMinX = 999, gMinY = 999, gMaxX = 0, gMaxY = 0;
  for (const { png } of allPngs) {
    const bb = findBBox(png.pixels, png.width, png.height);
    if (bb.w === 0) continue;
    if (bb.x < gMinX) gMinX = bb.x;
    if (bb.y < gMinY) gMinY = bb.y;
    if (bb.x + bb.w > gMaxX) gMaxX = bb.x + bb.w;
    if (bb.y + bb.h > gMaxY) gMaxY = bb.y + bb.h;
  }
  const cropW = gMaxX - gMinX;
  const cropH = gMaxY - gMinY;
  console.log(`Cropped size: ${cropW}x${cropH}`);

  // Pre-compute bounding box of each original Ryu pose
  interface PoseBBox { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number; centerX: number; bottom: number }
  const ryuBBoxes: PoseBBox[] = [];
  for (let i = 0; i < origAse.frames.length; i++) {
    const f = origAse.frames[i];
    let minX = frameW, minY = frameH, maxX = 0, maxY = 0;
    if (f?.pixels) {
      for (let y = 0; y < frameH; y++) {
        for (let x = 0; x < frameW; x++) {
          if (f.pixels[y * frameW + x] !== 15) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
    }
    const w = maxX >= minX ? maxX - minX + 1 : 0;
    const h = maxY >= minY ? maxY - minY + 1 : 0;
    ryuBBoxes.push({
      minX, minY, maxX, maxY, w, h,
      centerX: Math.floor((minX + maxX) / 2),
      bottom: maxY,
    });
  }
  console.log(`Computed bounding boxes for ${ryuBBoxes.length} poses`);
  console.log(`Example pose 0: ${ryuBBoxes[0]!.w}x${ryuBBoxes[0]!.h}, pose 20: ${ryuBBoxes[20]!.w}x${ryuBBoxes[20]!.h}`);

  // Crop all PixelLab PNGs to RGBA
  interface CroppedFrame { rgba: Uint8Array; label: string }
  const croppedFrames: CroppedFrame[] = [];
  for (const { png, label } of allPngs) {
    const croppedRGBA = new Uint8Array(cropW * cropH * 4);
    for (let y = 0; y < cropH; y++) {
      for (let x = 0; x < cropW; x++) {
        const si = ((gMinY + y) * png.width + (gMinX + x)) * 4;
        const di = (y * cropW + x) * 4;
        croppedRGBA[di] = png.pixels[si]!;
        croppedRGBA[di + 1] = png.pixels[si + 1]!;
        croppedRGBA[di + 2] = png.pixels[si + 2]!;
        croppedRGBA[di + 3] = png.pixels[si + 3]!;
      }
    }
    croppedFrames.push({ rgba: croppedRGBA, label });
  }
  console.log(`Cropped frames: ${croppedFrames.length}`);

  // Step 3: Compute bbox of each PixelLab frame (after crop)
  interface PLFrameData { rgba: Uint8Array; label: string; bbox: BBox }
  const plFrameData: PLFrameData[] = [];
  for (const cf of croppedFrames) {
    // Find bbox within cropped RGBA
    let minX = cropW, minY = cropH, maxX = 0, maxY = 0;
    for (let y = 0; y < cropH; y++) {
      for (let x = 0; x < cropW; x++) {
        if (cf.rgba[(y * cropW + x) * 4 + 3]! > 128) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const w = maxX >= minX ? maxX - minX + 1 : cropW;
    const h = maxY >= minY ? maxY - minY + 1 : cropH;
    plFrameData.push({ rgba: cf.rgba, label: cf.label, bbox: { x: minX, y: minY, w, h } });
  }

  // Step 4: For each Ryu pose, find the best matching PixelLab frame by shape
  // Score = distance in (aspect ratio, relative height in canvas, relative width)
  function shapeScore(ryuBB: PoseBBox, plBB: BBox): number {
    const ryuRatio = ryuBB.w / ryuBB.h;
    const plRatio = plBB.w / plBB.h;
    const ratioDiff = Math.abs(ryuRatio - plRatio);

    // Vertical position: how high in canvas (0 = bottom, 1 = top)
    const ryuVertPos = 1 - (ryuBB.bottom / frameH);
    const plVertPos = 1 - ((plBB.y + plBB.h) / cropH);
    const vertDiff = Math.abs(ryuVertPos - plVertPos);

    // Relative height: tall vs short
    const ryuRelH = ryuBB.h / frameH;
    const plRelH = plBB.h / cropH;
    const heightDiff = Math.abs(ryuRelH - plRelH);

    return ratioDiff * 3 + vertDiff * 2 + heightDiff;
  }

  const aseFrames: AsepriteFrame[] = [];
  const newManifestFrames: any[] = [];
  const matchLog: string[] = [];

  for (let i = 0; i < manifest.frames.length; i++) {
    const origFrame = manifest.frames[i];
    const ryuBB = ryuBBoxes[i]!;

    // Find best matching PixelLab frame
    let bestIdx = 0, bestScore = Infinity;
    for (let j = 0; j < plFrameData.length; j++) {
      const score = shapeScore(ryuBB, plFrameData[j]!.bbox);
      if (score < bestScore) { bestScore = score; bestIdx = j; }
    }

    const plFrame = plFrameData[bestIdx]!;
    matchLog.push(`pose_${i} (${ryuBB.w}x${ryuBB.h} r=${(ryuBB.w/ryuBB.h).toFixed(2)}) → ${plFrame.label} (score=${bestScore.toFixed(2)})`);

    const indexed = new Uint8Array(frameW * frameH).fill(15);

    if (ryuBB.w > 0 && ryuBB.h > 0) {
      // Scale to match Ryu's standing height (~92px)
      // Use this frame's own bbox for proper aspect ratio
      const plBB = plFrame.bbox;
      const targetH = ryuBBoxes[0]!.h; // ~92px
      const plScale = targetH / plBB.h;
      const scaledW = Math.round(plBB.w * plScale);
      const scaledH = Math.round(plBB.h * plScale);
      // Crop to this frame's own bbox, then scale
      const frameCrop = new Uint8Array(plBB.w * plBB.h * 4);
      for (let y = 0; y < plBB.h; y++) {
        for (let x = 0; x < plBB.w; x++) {
          const si = ((plBB.y + y) * cropW + (plBB.x + x)) * 4;
          const di = (y * plBB.w + x) * 4;
          frameCrop[di] = plFrame.rgba[si]!;
          frameCrop[di + 1] = plFrame.rgba[si + 1]!;
          frameCrop[di + 2] = plFrame.rgba[si + 2]!;
          frameCrop[di + 3] = plFrame.rgba[si + 3]!;
        }
      }
      const scaled = scaleRGBA(frameCrop, plBB.w, plBB.h, scaledW, scaledH);

      // Place center-bottom at this pose's center-bottom
      const placeX = ryuBB.centerX - Math.floor(scaledW / 2);
      const placeY = ryuBB.bottom - scaledH + 1;

      for (let y = 0; y < scaledH; y++) {
        for (let x = 0; x < scaledW; x++) {
          const dx = placeX + x;
          const dy = placeY + y;
          if (dx < 0 || dx >= frameW || dy < 0 || dy >= frameH) continue;
          const si = (y * scaledW + x) * 4;
          const idx = rgbaToPaletteIndex(scaled[si]!, scaled[si + 1]!, scaled[si + 2]!, scaled[si + 3]!);
          indexed[dy * frameW + dx] = idx;
        }
      }
    }

    aseFrames.push({ pixels: indexed, duration: 100 });
    newManifestFrames.push({
      id: origFrame.id,
      alignOffset: origFrame.alignOffset,
      tiles: origFrame.tiles,
    });
  }

  // Print matching log
  console.log('\nPose matching:');
  for (const line of matchLog) console.log('  ' + line);

  // Step 4: Write .aseprite
  const newManifest = {
    game: manifest.game,
    character: manifest.character,
    palette: manifest.palette,
    frameSize: manifest.frameSize,
    frames: newManifestFrames,
  };

  const data = writeAseprite({
    width: frameW,
    height: frameH,
    palette: RYU_PALETTE,
    frames: aseFrames,
    transparentIndex: 15,
    layerName: 'Big Man',
    manifest: newManifest,
    gridOffsetX: (manifest.frames[0]?.alignOffset?.x ?? 0) % 16,
    gridOffsetY: (manifest.frames[0]?.alignOffset?.y ?? 0) % 16,
  });

  const outPath = `/Users/privaloops/Downloads/bigman_sf2hf_${aseFrames.length}poses.aseprite`;
  writeFileSync(outPath, data);
  console.log(`\nSaved: ${outPath}`);
  console.log(`Size: ${(data.length / 1024).toFixed(1)} KB`);
}

main();
