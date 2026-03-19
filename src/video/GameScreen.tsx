/**
 * React DOM Renderer for CPS1
 *
 * Renders the game as DOM elements instead of canvas pixels.
 * Each sprite and tile is a <div> with CSS background-image/position.
 * Inspectable in DevTools — the game IS the DOM.
 */

import React, { memo, useRef, useEffect } from 'react';
import type { FrameState, ScrollLayerState, SpriteInfo } from './frame-state';
import type { SpriteSheetManager, TileSize } from './sprite-sheet';
import type { CPS1Video } from './cps1-video';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCREEN_WIDTH = 384;
const SCREEN_HEIGHT = 224;

// Layer ID constants (must match cps1-video.ts / frame-state.ts)
const LAYER_OBJ = 0;
const LAYER_SCROLL1 = 1;
const LAYER_SCROLL2 = 2;
const LAYER_SCROLL3 = 3;

// ---------------------------------------------------------------------------
// Tile component
// ---------------------------------------------------------------------------

interface TileProps {
  flipX: boolean;
  flipY: boolean;
  x: number;
  y: number;
  size: number;
  tileUrl: string;
}

const Tile = memo(function Tile({
  x, y, size, flipX, flipY, tileUrl,
}: TileProps) {
  let transform = '';
  if (flipX && flipY) transform = 'scaleX(-1) scaleY(-1)';
  else if (flipX) transform = 'scaleX(-1)';
  else if (flipY) transform = 'scaleY(-1)';

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: size,
        height: size,
        backgroundImage: `url(${tileUrl})`,
        backgroundSize: `${size}px ${size}px`,
        transform: transform || undefined,
        imageRendering: 'pixelated' as const,
      }}
    />
  );
});

// ---------------------------------------------------------------------------
// Row Scroll Canvas — hybrid canvas fallback for scroll2 parallax
// ---------------------------------------------------------------------------

interface RowScrollCanvasProps {
  zIndex: number;
  video: CPS1Video;
}

function RowScrollCanvas({ zIndex, video }: RowScrollCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Render scroll2 layer using the original pixel renderer (row scroll capable)
    const fb = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT * 4);
    video.renderSingleLayer(2, fb);

    const imageData = new ImageData(
      new Uint8ClampedArray(fb.buffer),
      SCREEN_WIDTH,
      SCREEN_HEIGHT,
    );
    ctx.putImageData(imageData, 0, 0);
  });

  return (
    <canvas
      ref={canvasRef}
      width={SCREEN_WIDTH}
      height={SCREEN_HEIGHT}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex,
        imageRendering: 'pixelated' as const,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Scroll Layer component
// ---------------------------------------------------------------------------

interface ScrollLayerProps {
  layer: ScrollLayerState;
  zIndex: number;
  sheets: SpriteSheetManager;
  vram: Uint8Array;
  paletteBase: number;
}

const ScrollLayer = memo(function ScrollLayer({
  layer, zIndex, sheets, vram, paletteBase,
}: ScrollLayerProps) {
  if (!layer.enabled || layer.tiles.length === 0) return null;

  const tileSize = layer.tileSize as TileSize;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        zIndex,
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: layer.virtualWidth,
          height: layer.virtualHeight,
          transform: `translate(${-layer.scrollX}px, ${-layer.scrollY}px)`,
          willChange: 'transform',
        }}
      >
        {layer.tiles.map((tile) => {
          const tileUrl = sheets.getTileUrl(tile.code, tileSize, tile.palette, vram, paletteBase);
          if (!tileUrl) return null;

          return (
            <Tile
              key={`${tile.x}-${tile.y}`}
              flipX={tile.flipX}
              flipY={tile.flipY}
              x={tile.x}
              y={tile.y}
              size={tileSize}
              tileUrl={tileUrl}
            />
          );
        })}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sprite component
// ---------------------------------------------------------------------------

interface SpriteProps {
  sprite: SpriteInfo;
  tileUrl: string;
}

const Sprite = memo(function Sprite({ sprite, tileUrl }: SpriteProps) {
  let transform = '';
  if (sprite.flipX && sprite.flipY) transform = 'scaleX(-1) scaleY(-1)';
  else if (sprite.flipX) transform = 'scaleX(-1)';
  else if (sprite.flipY) transform = 'scaleY(-1)';

  return (
    <div
      data-sprite={`code:${sprite.code} pal:${sprite.palette}`}
      style={{
        position: 'absolute',
        left: sprite.screenX,
        top: sprite.screenY,
        width: 16,
        height: 16,
        backgroundImage: `url(${tileUrl})`,
        backgroundSize: '16px 16px',
        transform: transform || undefined,
        imageRendering: 'pixelated' as const,
      }}
    />
  );
});

// ---------------------------------------------------------------------------
// Sprite Layer component
// ---------------------------------------------------------------------------

interface SpriteLayerProps {
  sprites: SpriteInfo[];
  zIndex: number;
  sheets: SpriteSheetManager;
  vram: Uint8Array;
  paletteBase: number;
}

const SpriteLayer = memo(function SpriteLayer({
  sprites, zIndex, sheets, vram, paletteBase,
}: SpriteLayerProps) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex,
      }}
    >
      {sprites.map((sprite, i) => {
        const tileUrl = sheets.getTileUrl(sprite.code, 16, sprite.palette, vram, paletteBase);
        if (!tileUrl) return null;

        return (
          <Sprite
            key={`s-${i}`}
            sprite={sprite}
            tileUrl={tileUrl}
          />
        );
      })}
    </div>
  );
});

// ---------------------------------------------------------------------------
// GameScreen — main component
// ---------------------------------------------------------------------------

interface GameScreenProps {
  frame: FrameState | null;
  sheets: SpriteSheetManager;
  vram: Uint8Array;
  video: CPS1Video | null;
  scale?: number;
}

function getLayerData(frame: FrameState, layerId: number): ScrollLayerState | null {
  switch (layerId) {
    case LAYER_SCROLL1: return frame.scroll1;
    case LAYER_SCROLL2: return frame.scroll2;
    case LAYER_SCROLL3: return frame.scroll3;
    default: return null;
  }
}

export function GameScreen({ frame, sheets, vram, video, scale = 2 }: GameScreenProps) {
  if (!frame) {
    return (
      <div style={{
        width: SCREEN_WIDTH * scale,
        height: SCREEN_HEIGHT * scale,
        background: '#000',
      }} />
    );
  }

  return (
    <div
      style={{
        width: SCREEN_WIDTH * scale,
        height: SCREEN_HEIGHT * scale,
        position: 'relative',
        overflow: 'hidden',
        background: '#000',
        imageRendering: 'pixelated' as const,
      }}
    >
      <div
        style={{
          width: SCREEN_WIDTH,
          height: SCREEN_HEIGHT,
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {frame.layerOrder.map((layerId, slot) => {
          if (layerId === LAYER_OBJ) {
            return (
              <SpriteLayer
                key="sprites"
                sprites={frame.sprites}
                zIndex={slot}
                sheets={sheets}
                vram={vram}
                paletteBase={frame.paletteBase}
              />
            );
          }

          const layerData = getLayerData(frame, layerId);
          if (!layerData) return null;

          return (
            <ScrollLayer
              key={`scroll-${layerId}`}
              layer={layerData}
              zIndex={slot}
              sheets={sheets}
              vram={vram}
              paletteBase={frame.paletteBase}
            />
          );
        })}
      </div>
    </div>
  );
}
