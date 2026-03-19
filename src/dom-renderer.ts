/**
 * DOM Renderer Entry Point — vanilla TypeScript, zero frameworks
 *
 * Alternative to index.ts — renders sprites as DOM divs, backgrounds as canvas.
 * Inspectable in DevTools. 60fps via direct DOM manipulation.
 */

import { Emulator } from './emulator';
import { FrameStateExtractor } from './video/frame-state';
import { SpriteSheetManager } from './video/sprite-sheet';
import { GameScreen } from './video/GameScreen';
import type { CPS1Video } from './video/cps1-video';

// ---------------------------------------------------------------------------
// DOM elements
// ---------------------------------------------------------------------------

const app = document.getElementById('app')!;

// Header
const header = document.createElement('header');
header.style.textAlign = 'center';
header.innerHTML = `
  <h1 style="font-size:1.4rem;letter-spacing:0.3em;text-transform:uppercase;color:#e8003c;text-shadow:0 0 12px #e8003c88;">open-arcade</h1>
  <p style="font-size:0.7rem;color:#555;letter-spacing:0.15em;margin-top:4px;">DOM Renderer — every sprite is a &lt;div&gt;</p>
`;
app.appendChild(header);

// Game container (drop zone before game starts)
const gameContainer = document.createElement('div');
gameContainer.style.cssText = 'margin: 16px auto; cursor: pointer; background: #0a0a0a; border: 1px solid #1a1a1a; width: 768px; height: 448px; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 8px;';
gameContainer.innerHTML = `
  <span style="font-size:0.85rem;color:#888;letter-spacing:0.15em;text-transform:uppercase;">Drop ROM ZIP here</span>
  <span style="font-size:0.65rem;color:#444;">or tap to browse</span>
`;
app.appendChild(gameContainer);

// File input (hidden)
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.zip';
fileInput.style.display = 'none';
app.appendChild(fileInput);

// Status
const statusEl = document.createElement('p');
statusEl.style.cssText = 'font-size:0.7rem;color:#444;letter-spacing:0.1em;text-align:center;margin-top:8px;';
statusEl.textContent = 'M=Mute P=Pause';
app.appendChild(statusEl);

// ---------------------------------------------------------------------------
// Emulator + GameScreen
// ---------------------------------------------------------------------------

// Hidden canvas for emulator (WebGL init needs one)
const hiddenCanvas = document.createElement('canvas');
hiddenCanvas.width = 384;
hiddenCanvas.height = 224;
hiddenCanvas.style.display = 'none';
document.body.appendChild(hiddenCanvas);

const emulator = new Emulator(hiddenCanvas);
let gameScreen: GameScreen | null = null;
let muted = false;

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' || e.key === 'm' || e.key === 'M') {
    muted = !muted;
    if (muted) emulator.suspendAudio(); else emulator.resumeAudio();
  } else if (e.code === 'KeyP' || e.key === 'p' || e.key === 'P') {
    if (emulator.isRunning()) { emulator.pause(); emulator.suspendAudio(); }
    else { emulator.resume(); if (!muted) emulator.resumeAudio(); }
  } else if (e.code === 'KeyF' || e.key === 'f' || e.key === 'F') {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void gameContainer.requestFullscreen();
    }
  } else if (e.code === 'Escape') {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    }
  }
});

// ---------------------------------------------------------------------------
// Fullscreen resize
// ---------------------------------------------------------------------------

document.addEventListener('fullscreenchange', () => {
  if (!gameScreen) return;
  if (document.fullscreenElement) {
    gameScreen.resize(window.innerWidth, window.innerHeight);
  } else {
    gameScreen.resetSize(2);
  }
});

// ---------------------------------------------------------------------------
// ROM loading
// ---------------------------------------------------------------------------

async function handleRomFile(file: File): Promise<void> {
  if (!file.name.endsWith('.zip')) {
    statusEl.textContent = 'Error: expected a .zip file';
    return;
  }

  statusEl.textContent = `Loading: ${file.name}...`;

  try {
    await emulator.initAudio();
    await emulator.loadRom(file);

    // Access emulator internals
    const internals = emulator as unknown as {
      bus: { getVram(): Uint8Array; getCpsaRegisters(): Uint8Array; getCpsbRegisters(): Uint8Array };
      video: unknown;
    };

    const vram = internals.bus.getVram();
    const cpsaRegs = internals.bus.getCpsaRegisters();
    const cpsbRegs = internals.bus.getCpsbRegisters();
    const video = internals.video as CPS1Video;

    const videoInternals = video as unknown as {
      graphicsRom: Uint8Array;
      mapperTable: Array<{ type: number; start: number; end: number; bank: number }>;
      bankSizes: number[];
      layerCtrlOffset: number;
      enableScroll1: number;
      enableScroll2: number;
      enableScroll3: number;
    };

    const sheets = new SpriteSheetManager(videoInternals.graphicsRom);

    const extractor = new FrameStateExtractor(
      vram, cpsaRegs, cpsbRegs,
      {
        layerControl: videoInternals.layerCtrlOffset,
        paletteControl: 0x30,
        priority: [0, 0, 0, 0],
        layerEnableMask: [
          videoInternals.enableScroll1,
          videoInternals.enableScroll2,
          videoInternals.enableScroll3,
          0, 0,
        ],
        idOffset: -1,
        idValue: 0,
      },
      {
        ranges: videoInternals.mapperTable,
        bankSizes: videoInternals.bankSizes as [number, number, number, number],
      },
    );

    // Replace drop zone with game screen
    gameContainer.innerHTML = '';
    gameContainer.style.cssText = '';
    gameContainer.style.margin = '16px auto';
    gameContainer.style.cursor = 'default';

    gameScreen = new GameScreen(gameContainer);
    gameScreen.setComponents(video, extractor, sheets, vram);

    // Hook renderFrame to our DOM updater
    (emulator as unknown as { renderFrame: () => void }).renderFrame = function () {
      gameScreen?.updateFrame();
    };

    emulator.resumeAudio();
    emulator.start();
    statusEl.textContent = `Running: ${file.name} — DOM Renderer`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    statusEl.textContent = `Error: ${msg}`;
    console.error('ROM load error:', err);
  }
}

// ---------------------------------------------------------------------------
// File picker + drag & drop
// ---------------------------------------------------------------------------

gameContainer.addEventListener('click', () => fileInput.click());

gameContainer.addEventListener('dragover', (e) => e.preventDefault());
gameContainer.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) {
    void emulator.initAudio();
    void handleRomFile(file);
  }
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) {
    void emulator.initAudio();
    void handleRomFile(file);
  }
  fileInput.value = '';
});

// Audio init on first interaction
const initAudio = (): void => {
  emulator.initAudio().catch(() => {});
  window.removeEventListener('click', initAudio);
  window.removeEventListener('keydown', initAudio);
};
window.addEventListener('click', initAudio);
window.addEventListener('keydown', initAudio);
