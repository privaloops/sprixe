/**
 * DOM Renderer Entry Point
 *
 * Alternative to index.ts — renders the game using React DOM instead of
 * Canvas/WebGL. The emulation core is unchanged; only the video output
 * goes through React components.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Emulator } from './emulator';
import { FrameStateExtractor } from './video/frame-state';
import type { FrameState } from './video/frame-state';
import { SpriteSheetManager } from './video/sprite-sheet';
import { GameScreen } from './video/GameScreen';
import type { CPS1Video } from './video/cps1-video';

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

function App() {
  const [frame, setFrame] = useState<FrameState | null>(null);
  const [status, setStatus] = useState('Drop a ROM ZIP or click to browse');
  const [gameRunning, setGameRunning] = useState(false);

  const emulatorRef = useRef<Emulator | null>(null);
  const extractorRef = useRef<FrameStateExtractor | null>(null);
  const sheetsRef = useRef<SpriteSheetManager | null>(null);
  const vramRef = useRef<Uint8Array | null>(null);
  const videoRef = useRef<CPS1Video | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Create a hidden canvas for the emulator (it still needs one for WebGL init)
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 224;
    canvas.style.display = 'none';
    document.body.appendChild(canvas);
    canvasRef.current = canvas;

    const emulator = new Emulator(canvas);
    emulatorRef.current = emulator;

    // Keyboard shortcuts
    let muted = false;
    const onKey = (e: KeyboardEvent) => {
      const emu = emulatorRef.current;
      if (!emu) return;
      if (e.code === 'KeyM' || e.key === 'm' || e.key === 'M') {
        muted = !muted;
        if (muted) emu.suspendAudio(); else emu.resumeAudio();
      } else if (e.code === 'KeyP') {
        if (emu.isRunning()) { emu.pause(); emu.suspendAudio(); }
        else { emu.resume(); if (!muted) emu.resumeAudio(); }
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      emulator.destroy();
      canvas.remove();
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.zip')) {
      setStatus('Error: expected a .zip file');
      return;
    }

    const emulator = emulatorRef.current;
    if (!emulator) return;

    setStatus(`Loading: ${file.name}...`);

    try {
      await emulator.initAudio();
      await emulator.loadRom(file);

      // Access internal state for the frame extractor
      // We need to reach into the emulator's internals
      const internals = (emulator as unknown as {
        bus: { getVram(): Uint8Array; getCpsaRegisters(): Uint8Array; getCpsbRegisters(): Uint8Array };
        video: { cpsBConfig?: unknown; gfxMapper?: unknown } | null;
      });

      const vram = internals.bus.getVram();
      const cpsaRegs = internals.bus.getCpsaRegisters();
      const cpsbRegs = internals.bus.getCpsbRegisters();
      vramRef.current = vram;

      // Get the GFX ROM from the emulator's video component
      const videoInternals = (internals.video as unknown as {
        graphicsRom: Uint8Array;
        mapperTable: Array<{ type: number; start: number; end: number; bank: number }>;
        bankSizes: number[];
        bankBases: number[];
        layerCtrlOffset: number;
        enableScroll1: number;
        enableScroll2: number;
        enableScroll3: number;
      });

      if (!videoInternals) {
        setStatus('Error: video not initialized');
        return;
      }

      // Store video reference for canvas fallback (row scroll)
      videoRef.current = internals.video as unknown as CPS1Video;

      // Create sprite sheet manager from GFX ROM
      sheetsRef.current = new SpriteSheetManager(videoInternals.graphicsRom);

      // Create frame state extractor — shares the same VRAM/registers
      // We pass the same CPS-B config the video component uses
      extractorRef.current = new FrameStateExtractor(
        vram,
        cpsaRegs,
        cpsbRegs,
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

      emulator.resumeAudio();
      emulator.start();
      setGameRunning(true);
      setStatus(`Running: ${file.name} — DOM Renderer`);

      // Hook into the frame loop: extract state after each frame
      // Throttle DOM updates — emulation runs at 60fps but DOM only needs ~15-20fps
      let frameCounter = 0;
      const DOM_FRAME_SKIP = 3; // update DOM every 3rd frame = 20fps

      (emulator as unknown as { renderFrame: () => void }).renderFrame = function () {
        frameCounter++;
        if (frameCounter % DOM_FRAME_SKIP !== 0) return;

        const extractor = extractorRef.current;
        if (extractor) {
          const state = extractor.extractFrame();
          setFrame(state);
        }
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`Error: ${msg}`);
      console.error('ROM load error:', err);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }, [handleFile]);

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void emulatorRef.current?.initAudio();
      void handleFile(file);
    }
  }, [handleFile]);

  return (
    <div style={{
      background: '#000',
      color: '#fff',
      fontFamily: '"Courier New", monospace',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
    }}>
      <h1 style={{
        fontSize: '1.4rem',
        letterSpacing: '0.3em',
        textTransform: 'uppercase' as const,
        color: '#e8003c',
        textShadow: '0 0 12px #e8003c88',
      }}>
        open-arcade
      </h1>
      <p style={{ fontSize: '0.7rem', color: '#555', letterSpacing: '0.15em' }}>
        DOM Renderer — every sprite is a {'<div>'}
      </p>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={gameRunning ? undefined : handleClick}
        style={{
          position: 'relative',
          cursor: gameRunning ? undefined : 'pointer',
          background: '#0a0a0a',
          border: '1px solid #1a1a1a',
        }}
      >
        {frame && sheetsRef.current && vramRef.current ? (
          <GameScreen
            frame={frame}
            sheets={sheetsRef.current}
            vram={vramRef.current}
            video={videoRef.current}
          />
        ) : (
          <div style={{
            width: 768,
            height: 448,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 8,
          }}>
            <span style={{ fontSize: '0.85rem', color: '#888', letterSpacing: '0.15em', textTransform: 'uppercase' as const }}>
              Drop ROM ZIP here
            </span>
            <span style={{ fontSize: '0.65rem', color: '#444' }}>
              or tap to browse
            </span>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />

      <p style={{ fontSize: '0.7rem', color: '#444', letterSpacing: '0.1em' }}>
        {status}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const container = document.getElementById('app');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
