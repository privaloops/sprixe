# Arcade.ts

Émulateur CPS1 (Capcom Play System 1) from scratch dans le browser.
TypeScript strict + WebGL2 + Web Worker audio + WASM. Zéro dépendance d'émulation.

## Commandes

```bash
npm run dev      # Serveur de développement Vite (hot reload)
npm run build    # Compilation TypeScript + build Vite (sortie dans dist/)
npm run preview  # Prévisualisation du build de production
npm test         # Tests unitaires (vitest)
npm run test:watch  # Tests en mode watch
```

## Structure

```
src/
  cpu/
    m68000.ts       # Motorola 68000 interpréteur (~3000 lignes)
    z80.ts          # Zilog Z80 interpréteur (~2250 lignes)
  video/
    cps1-video.ts   # CPS-A/CPS-B tile decode, layers, sprites, palette
    renderer.ts     # Canvas 2D renderer (fallback)
    renderer-webgl.ts # WebGL2 renderer (texture upload, default)
    GameScreen.ts   # DOM renderer — hybrid canvas+DOM (experimental)
    sprite-sheet.ts # Sprite tile cache (ImageData, no data URLs)
    frame-state.ts  # Frame state extractor for DOM renderer
  audio/
    audio-worker.ts   # Web Worker: Z80 + YM2151 + OKI autonomous audio
    audio-output.ts   # AudioWorklet + SharedArrayBuffer ring buffer
    nuked-opm-wasm.ts # Nuked OPM (YM2151) WASM wrapper — cycle-accurate FM
    oki6295.ts        # OKI MSM6295 ADPCM decoder
    qsound-wasm.ts    # QSound DSP HLE WASM (CPS1.5 games)
    resampler.ts      # LinearResampler (shared main thread / worker)
  memory/
    bus.ts          # Bus 68000 — memory map, I/O, CPS-A/B registers
    z80-bus.ts      # Bus Z80 — audio ROM, RAM, YM2151, OKI, sound latch
    z80-bus-qsound.ts # Bus Z80 QSound — shared RAM, DSP I/O
    rom-loader.ts   # ROM loader ZIP/MAME + 41 GameDefs + CPS-B configs + GFX mappers
    game-defs.ts    # Per-game ROM layouts, CPS-B configs, GFX mappers
    kabuki.ts       # Kabuki Z80 decryption (QSound games)
    eeprom-93c46.ts # EEPROM 93C46 serial protocol (QSound games)
  input/
    input.ts        # Keyboard + Gamepad API + device assignment + autofire
  game-catalog.ts   # 245 jeux CPS1 (source MAME 0.286)
  save-state.ts     # Save/load state (4 slots, localStorage)
  dip-switches.ts   # DIP switch definitions (56 games, from MAME)
  types.ts          # Interfaces partagées (BusInterface, Z80BusInterface)
  index.ts          # Entry point — UI, config modal, shortcuts
  emulator.ts       # Main loop — frame scheduling, CPU/video orchestration
wasm/
  opm.c, opm.h      # Source C Nuked OPM (LGPL 2.1+, github.com/nukeykt/Nuked-OPM)
  opm_wrapper.c     # Wrapper C pour Emscripten
  opm.mjs           # WASM compilé (ESM, SINGLE_FILE)
src/__tests__/
  bus.test.ts       # Tests bus address decoding
  m68000.test.ts    # Tests CPU M68000 (opcodes basiques)
  m68000-tom-harte.test.ts  # Tests M68000 Tom Harte (84 instructions, 200 vecteurs chacune)
  z80-tom-harte.test.ts     # Tests Z80 SingleStepTests (588 instructions, 200 vecteurs chacune)
  oki6295.test.ts   # Tests OKI6295 (ADPCM, commandes)
tests/
  68000/*.json      # Vecteurs Tom Harte M68000 (ProcessorTests)
  z80/*.json        # Vecteurs SingleStepTests Z80 (JSMoo)
```

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Langage | TypeScript (strict: noUncheckedIndexedAccess, exactOptionalPropertyTypes) |
| Build | Vite |
| Rendu | WebGL2 (fallback Canvas 2D, experimental DOM) |
| Audio FM | Nuked OPM → WASM (Emscripten, -O3) |
| Audio ADPCM | OKI MSM6295 en TS |
| Audio QSound | QSound HLE → WASM |
| Audio output | Web Worker + AudioWorklet + SharedArrayBuffer |
| Tests | Vitest |
| UI | HTML/CSS vanilla |
| Hosting | Vercel (COOP/COEP headers) |

## Référence hardware CPS1

| Composant | Spec |
|-----------|------|
| CPU principal | Motorola 68000 @ 10 MHz |
| CPU audio | Zilog Z80 @ 3.579545 MHz |
| Vidéo | CPS-A + CPS-B (3 scroll layers + 1 sprite layer) |
| Audio FM | YM2151 (OPM) — 8 canaux, 4 opérateurs, 55930 Hz |
| Audio ADPCM | OKI MSM6295 — 4 voix, 7575 Hz |
| Audio QSound | DSP custom — spatialisation, 24038 Hz |
| Résolution | 384×224 @ ~59.637 Hz |
| VRAM | 192 KB |
| Work RAM | 64 KB |

## Performance (profiled)

| Composant | CPU % | Notes |
|-----------|-------|-------|
| M68000 | ~25% | Interpréteur TS, ~168K instructions/frame |
| Z80 + OPM WASM | ~8% | Web Worker autonome |
| Vidéo (CPU decode + WebGL2) | ~3% | Tile decode + texture upload |
| **Total** | **~33%** | Sur Mac, Chrome |

## Jeux supportés

41 GameDefs (parent sets) avec ROM layout, CPS-B config, et GFX mapper.
245 jeux listés dans le catalogue (source MAME 0.286).
ROMs chargées depuis public/roms/ (non incluses dans le repo).

## Raccourcis clavier

| Touche | Action |
|--------|--------|
| Arrows | Move |
| A, S, D | Buttons 1-3 |
| Z, X, C | Buttons 4-6 |
| 5 | Insert coin |
| 1 | 1P Start |
| P | Pause / Resume |
| M | Mute |
| F1 | Config |
| F5 | Save state |
| F8 | Load state |
| Double-click | Fullscreen |
| Escape | Close dialog |

## Architecture audio

```
Main Thread                     Audio Worker (Web Worker)
───────────                     ────────────────────────
68K écrit sound latch  ───────→ Z80 (3.58 MHz, autonomous timer)
                                ├─ YM2151 WASM (cycle-accurate)
                                └─ OKI6295 (TS ADPCM)
                                Resampling → 48kHz
                                Mixing: ymL*0.35 + ymR*0.35 + oki*0.30
                                ↓
                                SharedArrayBuffer ring buffer (8192 samples)
                                ↓
                                AudioWorklet (separate thread) → speakers
```

Le Z80 audio tourne en autonome dans le Worker, comme sur le vrai hardware où il a son propre cristal.
Le main thread ne poste que les sound latches via postMessage.

Pour les jeux QSound (Dino, Punisher, WoF, Slammast), le Z80 reste sur le main thread (interleaved per-scanline avec le 68K car communication via shared RAM).

## Headers requis (dev server)

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```
Sans ces headers, SharedArrayBuffer est indisponible → fallback ScriptProcessorNode (main thread).
`vercel.json` configure ces headers pour le déploiement Vercel.

## Build WASM (Nuked OPM)

```bash
source ~/emsdk/emsdk_env.sh
cd wasm
emcc -O3 opm.c opm_wrapper.c -o opm.mjs \
  -s WASM=1 -s MODULARIZE=1 -s EXPORT_NAME='createOPM' -s EXPORT_ES6=1 \
  -s SINGLE_FILE=1 -s FILESYSTEM=0 -s ENVIRONMENT='web' \
  -s INITIAL_MEMORY=1048576 \
  -s EXPORTED_FUNCTIONS='["_opm_init","_opm_reset","_opm_write_address","_opm_write_data","_opm_read_status","_opm_read_irq","_opm_clock_cycles","_opm_get_sample_count","_opm_get_samples_l","_opm_get_samples_r","_opm_drain_samples","_opm_get_sample_rate"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPF32"]'
```

## Sources et crédits

- Nuked OPM: [nukeykt/Nuked-OPM](https://github.com/nukeykt/Nuked-OPM) (LGPL 2.1+)
- Game definitions: [mamedev/mame](https://github.com/mamedev/mame) src/mame/capcom/cps1.cpp + cps1_v.cpp
- ROM catalog: MAME 0.286 via `mame -listxml`
- DIP switches: parsed from MAME cps1.cpp INPUT_PORTS blocks

## mdma

- **Workflow** : `default`
- **Git** : `default`
