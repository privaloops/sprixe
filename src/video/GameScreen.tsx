/**
 * React DOM Renderer for CPS1 — Hybrid mode
 *
 * Scroll layers (background tiles) → single <canvas> via pixel rasterizer
 * Sprites → DOM <div> elements, inspectable in DevTools
 *
 * ~256 DOM nodes instead of ~2000. The interesting part (sprites) stays
 * as divs; the boring part (background tiles) is a fast canvas.
 */

import React, { memo, useRef, useEffect } from 'react';
import type { FrameState, SpriteInfo } from './frame-state';
import type { SpriteSheetManager } from './sprite-sheet';
import type { CPS1Video } from './cps1-video';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCREEN_WIDTH = 384;
const SCREEN_HEIGHT = 224;

// Layer ID constants
const LAYER_OBJ = 0;

// ---------------------------------------------------------------------------
// Background Canvas — renders all 3 scroll layers via pixel rasterizer
// ---------------------------------------------------------------------------

interface BackgroundCanvasProps {
  video: CPS1Video;
  layerOrder: number[];
  zIndices: Map<number, number>;
}

function BackgroundCanvas({ video, layerOrder, zIndices }: BackgroundCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const fbRef = useRef<Uint8Array>(new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT * 4));

  useEffect(() => {
    if (canvasRef.current && !ctxRef.current) {
      ctxRef.current = canvasRef.current.getContext('2d')!;
    }
  }, []);

  // Render scroll layers every frame this component renders
  const ctx = ctxRef.current;
  if (ctx) {
    const fb = fbRef.current;
    // Render all scroll layers in priority order (skipping sprites)
    const scrollIds = layerOrder.filter(id => id !== LAYER_OBJ);
    video.renderScrollLayers(scrollIds, fb);

    const imageData = new ImageData(
      new Uint8ClampedArray(fb.buffer as ArrayBuffer),
      SCREEN_WIDTH,
      SCREEN_HEIGHT,
    );
    ctx.putImageData(imageData, 0, 0);
  }

  // z-index: behind all sprite layers, use the lowest scroll layer slot
  let minScrollZ = 0;
  for (const [id, z] of zIndices) {
    if (id !== LAYER_OBJ) {
      minScrollZ = Math.min(minScrollZ, z);
      break;
    }
  }

  return (
    <canvas
      ref={canvasRef}
      width={SCREEN_WIDTH}
      height={SCREEN_HEIGHT}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: minScrollZ,
        imageRendering: 'pixelated' as const,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Sprite component — each sprite is a <div>
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
// Sprite Layer — all sprites in one container
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

export function GameScreen({ frame, sheets, vram, video, scale = 2 }: GameScreenProps) {
  if (!frame || !video) {
    return (
      <div style={{
        width: SCREEN_WIDTH * scale,
        height: SCREEN_HEIGHT * scale,
        background: '#000',
      }} />
    );
  }

  // Build z-index map from layer order
  const zIndices = new Map<number, number>();
  frame.layerOrder.forEach((layerId, slot) => {
    zIndices.set(layerId, slot);
  });

  const spriteZIndex = zIndices.get(LAYER_OBJ) ?? 2;

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
        {/* Scroll layers: single canvas (fast pixel rasterizer) */}
        <BackgroundCanvas
          video={video}
          layerOrder={frame.layerOrder}
          zIndices={zIndices}
        />

        {/* Sprites: DOM divs (inspectable in DevTools) */}
        <SpriteLayer
          sprites={frame.sprites}
          zIndex={spriteZIndex}
          sheets={sheets}
          vram={vram}
          paletteBase={frame.paletteBase}
        />
      </div>
    </div>
  );
}
