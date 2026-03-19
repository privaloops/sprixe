/**
 * DOM Game Screen — vanilla TypeScript, zero frameworks
 *
 * Scroll layers → single <canvas> via pixel rasterizer
 * Sprites → pool of 256 pre-created <div> elements, updated via direct DOM
 *
 * 60fps. No virtual DOM. No reconciliation. Just style assignments.
 */

import type { FrameStateExtractor } from './frame-state';
import type { SpriteSheetManager } from './sprite-sheet';
import type { CPS1Video } from './cps1-video';

const SCREEN_WIDTH = 384;
const SCREEN_HEIGHT = 224;
const MAX_SPRITES = 256;
const LAYER_OBJ = 0;

export class GameScreen {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly spritePool: HTMLDivElement[] = [];
  private readonly fb: Uint8Array;

  private video: CPS1Video | null = null;
  private extractor: FrameStateExtractor | null = null;
  private sheets: SpriteSheetManager | null = null;
  private vram: Uint8Array | null = null;

  private readonly inner: HTMLDivElement;
  private scale: number;

  constructor(parent: HTMLElement, scale: number = 2) {
    this.scale = scale;

    // Root container
    this.root = document.createElement('div');
    this.root.style.cssText = `
      width: ${SCREEN_WIDTH * scale}px;
      height: ${SCREEN_HEIGHT * scale}px;
      position: relative;
      overflow: hidden;
      background: #000;
      image-rendering: pixelated;
    `;

    // Inner container (scaled)
    this.inner = document.createElement('div');
    this.inner.style.cssText = `
      width: ${SCREEN_WIDTH}px;
      height: ${SCREEN_HEIGHT}px;
      position: absolute;
      top: 0; left: 0;
      transform: scale(${scale});
      transform-origin: top left;
    `;
    const inner = this.inner;

    // Background canvas (scroll layers)
    this.canvas = document.createElement('canvas');
    this.canvas.width = SCREEN_WIDTH;
    this.canvas.height = SCREEN_HEIGHT;
    this.canvas.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 0;
      image-rendering: pixelated;
    `;
    this.ctx = this.canvas.getContext('2d')!;
    this.fb = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT * 4);

    // Sprite container
    const spriteContainer = document.createElement('div');
    spriteContainer.style.cssText = 'position: absolute; inset: 0; z-index: 1;';

    // Pre-create 256 sprite divs
    for (let i = 0; i < MAX_SPRITES; i++) {
      const div = document.createElement('div');
      div.style.cssText = `
        position: absolute;
        width: 16px; height: 16px;
        background-size: 16px 16px;
        image-rendering: pixelated;
        display: none;
      `;
      spriteContainer.appendChild(div);
      this.spritePool.push(div);
    }

    inner.appendChild(this.canvas);
    inner.appendChild(spriteContainer);
    this.root.appendChild(inner);
    parent.appendChild(this.root);
  }

  /** Set the emulation components (call after ROM load). */
  setComponents(
    video: CPS1Video,
    extractor: FrameStateExtractor,
    sheets: SpriteSheetManager,
    vram: Uint8Array,
  ): void {
    this.video = video;
    this.extractor = extractor;
    this.sheets = sheets;
    this.vram = vram;
  }

  /** Returns the root DOM element (for layout). */
  getElement(): HTMLDivElement {
    return this.root;
  }

  /** Call once per frame from the emulator loop. */
  updateFrame(): void {
    if (!this.video || !this.extractor || !this.sheets || !this.vram) return;

    const frame = this.extractor.extractFrame();

    // 1. Render scroll layers to canvas
    const scrollIds = frame.layerOrder.filter(id => id !== LAYER_OBJ);
    this.video.renderScrollLayers(scrollIds, this.fb);
    const imageData = new ImageData(
      new Uint8ClampedArray(this.fb.buffer as ArrayBuffer),
      SCREEN_WIDTH,
      SCREEN_HEIGHT,
    );
    this.ctx.putImageData(imageData, 0, 0);

    // 2. Update sprite divs
    const sprites = frame.sprites;
    const paletteBase = frame.paletteBase;
    const sheets = this.sheets;
    const vram = this.vram;

    for (let i = 0; i < MAX_SPRITES; i++) {
      const div = this.spritePool[i]!;

      if (i >= sprites.length) {
        if (div.style.display !== 'none') div.style.display = 'none';
        continue;
      }

      const sprite = sprites[i]!;
      const isMulti = sprite.nx > 1 || sprite.ny > 1;

      const tileUrl = isMulti
        ? sheets.getMultiTileUrl(sprite.code, sprite.nx, sprite.ny, sprite.palette, vram, paletteBase)
        : sheets.getTileUrl(sprite.code, 16, sprite.palette, vram, paletteBase);

      if (!tileUrl) {
        if (div.style.display !== 'none') div.style.display = 'none';
        continue;
      }

      // Update size for multi-tile sprites
      const w = sprite.nx * 16;
      const h = sprite.ny * 16;
      if (div.offsetWidth !== w) {
        div.style.width = w + 'px';
        div.style.backgroundSize = w + 'px ' + h + 'px';
      }
      if (div.offsetHeight !== h) {
        div.style.height = h + 'px';
      }

      div.style.left = sprite.screenX + 'px';
      div.style.top = sprite.screenY + 'px';

      const bgUrl = `url(${tileUrl})`;
      if (div.style.backgroundImage !== bgUrl) {
        div.style.backgroundImage = bgUrl;
      }

      let transform = '';
      if (sprite.flipX && sprite.flipY) transform = 'scaleX(-1) scaleY(-1)';
      else if (sprite.flipX) transform = 'scaleX(-1)';
      else if (sprite.flipY) transform = 'scaleY(-1)';
      if (div.style.transform !== transform) {
        div.style.transform = transform;
      }

      div.dataset['sprite'] = `code:${sprite.code} pal:${sprite.palette}${isMulti ? ` ${sprite.nx}x${sprite.ny}` : ''}`;

      if (div.style.display === 'none') div.style.display = '';
    }
  }

  /** Resize to fill the given dimensions (call on fullscreen change). */
  resize(width: number, height: number): void {
    const scaleX = width / SCREEN_WIDTH;
    const scaleY = height / SCREEN_HEIGHT;
    const s = Math.min(scaleX, scaleY); // no floor — fill 100%

    this.root.style.width = width + 'px';
    this.root.style.height = height + 'px';

    // Center the inner container
    const scaledW = SCREEN_WIDTH * s;
    const scaledH = SCREEN_HEIGHT * s;
    this.inner.style.transform = `scale(${s})`;
    this.inner.style.left = Math.floor((width - scaledW) / 2) + 'px';
    this.inner.style.top = Math.floor((height - scaledH) / 2) + 'px';
  }

  /** Reset to default scale. */
  resetSize(scale: number = 2): void {
    this.scale = scale;
    this.root.style.width = SCREEN_WIDTH * scale + 'px';
    this.root.style.height = SCREEN_HEIGHT * scale + 'px';
    this.inner.style.transform = `scale(${scale})`;
    this.inner.style.left = '0px';
    this.inner.style.top = '0px';
  }

  /** Remove from DOM. */
  destroy(): void {
    this.root.remove();
  }
}
