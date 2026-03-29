/**
 * Scroll Capture — accumulate scroll layer tiles during gameplay.
 *
 * Captures visible tiles from a scroll layer each frame, building up
 * a complete tilemap as the player scrolls through the stage.
 * Tiles are grouped by palette for Aseprite export.
 */

import type { CPS1Video } from '../video/cps1-video';
import { LAYER_SCROLL1, LAYER_SCROLL2, LAYER_SCROLL3, tilemap0Scan, tilemap1Scan, tilemap2Scan } from '../video/cps1-video';
import { SCREEN_WIDTH, SCREEN_HEIGHT } from '../constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScrollTile {
  /** Mapped GFX ROM tile code */
  tileCode: number;
  /** Key for dedup: "tileCol,tileRow" in tilemap space */
  key: string;
  /** Column/row in the 64x64 tilemap */
  tileCol: number;
  tileRow: number;
  /** Palette index (absolute, including group offset) */
  palette: number;
  /** Flip flags */
  flipX: boolean;
  flipY: boolean;
  /** Tile dimensions */
  tileW: number;
  tileH: number;
  /** Byte size in GFX ROM */
  charSize: number;
  /** Raw code (before bank mapping) for manifest */
  rawCode: number;
}

export interface ScrollSet {
  /** Layer ID (LAYER_SCROLL1, LAYER_SCROLL2, LAYER_SCROLL3) */
  layerId: number;
  /** Palette index for this set */
  palette: number;
  /** Unique tiles */
  tiles: ScrollTile[];
  /** Tile dimensions for this layer */
  tileW: number;
  tileH: number;
}

export interface ScrollCaptureSession {
  layerId: number;
  /** All captured tiles keyed by "virtualCol,tileRow" (virtualCol extends beyond 64 on wrap) */
  tileMap: Map<string, ScrollTile>;
  /** Current VRAM content: col,row → tileCode (to detect streaming changes) */
  vramContent: Map<string, number>;
  /** Column offset when wrap is detected (extends the virtual canvas) */
  colOffset: number;
  /** Last seen left-most column on screen (to detect scroll direction) */
  lastLeftCol: number;
  tileW: number;
  tileH: number;
}

// ---------------------------------------------------------------------------
// Inverse tilemap scan — build col/row lookup from tileIndex
// ---------------------------------------------------------------------------

function buildInverseScan(scanFn: (col: number, row: number) => number): Map<number, [number, number]> {
  const map = new Map<number, [number, number]>();
  for (let row = 0; row < 64; row++) {
    for (let col = 0; col < 64; col++) {
      map.set(scanFn(col, row), [col, row]);
    }
  }
  return map;
}

const inverseScan1 = buildInverseScan(tilemap0Scan);
const inverseScan2 = buildInverseScan(tilemap1Scan);
const inverseScan3 = buildInverseScan(tilemap2Scan);

function getInverseScan(layerId: number): Map<number, [number, number]> {
  switch (layerId) {
    case LAYER_SCROLL1: return inverseScan1;
    case LAYER_SCROLL2: return inverseScan2;
    case LAYER_SCROLL3: return inverseScan3;
    default: return inverseScan2;
  }
}

// ---------------------------------------------------------------------------
// Capture logic
// ---------------------------------------------------------------------------

export function createScrollSession(layerId: number): ScrollCaptureSession {
  const tileW = layerId === LAYER_SCROLL1 ? 8 : layerId === LAYER_SCROLL2 ? 16 : 32;
  return {
    layerId,
    tileMap: new Map(),
    vramContent: new Map(),
    colOffset: 0,
    lastLeftCol: -1,
    tileW,
    tileH: tileW,
  };
}

/**
 * Capture all visible tiles of a scroll layer for the current frame.
 * Uses inspectScrollAt to read tile info at each tile position.
 * Returns the number of new tiles found.
 */
export function captureScrollFrame(
  session: ScrollCaptureSession,
  video: CPS1Video,
): number {
  const { layerId, tileW, tileH } = session;
  let newTiles = 0;

  const inverseScan = getInverseScan(layerId);

  // First: find leftmost visible column this frame (to detect wrap)
  let frameLeftCol = 64;
  {
    const info = video.inspectScrollAt(tileW >> 1, tileH >> 1, layerId, true);
    if (info && info.tileCode !== -1) {
      const cr = inverseScan.get(info.tileIndex);
      if (cr) frameLeftCol = cr[0];
    }
  }

  // Detect wrap: left column jumped backwards significantly
  if (session.lastLeftCol >= 0 && frameLeftCol < session.lastLeftCol && session.lastLeftCol - frameLeftCol > 32) {
    session.colOffset += 64;
  }
  if (frameLeftCol < 64) session.lastLeftCol = frameLeftCol;

  // Capture all visible tiles
  for (let sy = 0; sy < SCREEN_HEIGHT; sy += tileH) {
    for (let sx = 0; sx < SCREEN_WIDTH; sx += tileW) {
      const px = Math.min(sx + (tileW >> 1), SCREEN_WIDTH - 1);
      const py = Math.min(sy + (tileH >> 1), SCREEN_HEIGHT - 1);

      const info = video.inspectScrollAt(px, py, layerId, true);
      if (!info || info.tileCode === -1) continue;

      const colRow = inverseScan.get(info.tileIndex);
      if (!colRow) continue;
      const [tileCol, tileRow] = colRow;

      // Virtual column: raw col + wrap offset
      const virtualCol = tileCol + session.colOffset;
      const key = `${virtualCol},${tileRow}`;

      if (!session.tileMap.has(key)) {
        const tile: ScrollTile = {
          tileCode: info.tileCode,
          key,
          tileCol: virtualCol,
          tileRow,
          palette: info.paletteIndex,
          flipX: info.flipX,
          flipY: info.flipY,
          tileW: info.tileW,
          tileH: info.tileH,
          charSize: info.charSize,
          rawCode: info.rawCode,
        };

        session.tileMap.set(key, tile);
        newTiles++;
      }
    }
  }

  return newTiles;
}

/**
 * Build scroll sets from a capture session (one per palette).
 */
export function buildScrollSets(session: ScrollCaptureSession): ScrollSet[] {
  const byPalette = new Map<number, ScrollTile[]>();

  for (const tile of session.tileMap.values()) {
    let list = byPalette.get(tile.palette);
    if (!list) {
      list = [];
      byPalette.set(tile.palette, list);
    }
    list.push(tile);
  }

  const sets: ScrollSet[] = [];
  for (const [palette, tiles] of byPalette) {
    if (tiles.length === 0) continue;
    sets.push({
      layerId: session.layerId,
      palette,
      tiles,
      tileW: session.tileW,
      tileH: session.tileH,
    });
  }

  sets.sort((a, b) => a.palette - b.palette);
  return sets;
}

/**
 * Get layer name for display.
 */
export function scrollLayerName(layerId: number): string {
  switch (layerId) {
    case LAYER_SCROLL1: return 'Scroll 1 (8×8)';
    case LAYER_SCROLL2: return 'Scroll 2 (16×16)';
    case LAYER_SCROLL3: return 'Scroll 3 (32×32)';
    default: return `Layer ${layerId}`;
  }
}
