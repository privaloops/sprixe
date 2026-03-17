# CPS1-Web

Émulateur CPS1 (Capcom Play System 1) from scratch dans le browser.
TypeScript strict + WebGPU + WebRTC. Zéro dépendance d'émulation.

## Vision

Drag & drop d'une ROM ZIP (format MAME), lecture directe dans le browser.
Netplay peer-to-peer via WebRTC avec rollback (inspiré GGPO).

## Commandes

```bash
npm run dev      # Serveur de développement Vite (hot reload)
npm run build    # Compilation TypeScript + build Vite (sortie dans dist/)
npm run preview  # Prévisualisation du build de production
```

## Structure

```
src/
  cpu/          # M68000 (main CPU), Z80 (audio CPU) — interpréteurs cycle-accurate
  video/        # CPS-A/CPS-B (custom GPU), WebGPU renderer + shaders CRT
  audio/        # YM2151 (FM synthesis), OKI6295 (ADPCM), AudioWorklet
  memory/       # Bus 68000/Z80, memory map, ROM loader (ZIP/MAME format)
  input/        # Keyboard mapping, Gamepad API
  netplay/      # WebRTC DataChannels, rollback algorithm, signaling
  ui/           # HTML helpers, drag & drop, HUD
  index.ts      # Entry point — bootstrap canvas + ROM loader
public/
  index.html    # Page principale : canvas 384x224 + zone drag & drop
```

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Langage | TypeScript (strict) |
| Build | Vite |
| Rendu | WebGPU (fallback WebGL2) |
| Audio | AudioWorklet |
| Netplay | WebRTC DataChannels |
| UI | HTML/CSS vanilla |

## Référence hardware

- CPU principal : Motorola 68000 @ 10 MHz
- CPU audio : Zilog Z80 @ 3.58 MHz
- GPU custom : CPS-A + CPS-B (3 scroll layers, 1 sprite layer, 192 palettes)
- Audio FM : YM2151 (OPM) — 8 canaux, 4 opérateurs
- Audio ADPCM : OKI MSM6295 — 4 voix simultanées
- Résolution native : 384x224

Voir `MASTER-PLAN.md` pour l'architecture complète et les phases de développement.

## mdma

- **Workflow** : `default`
- **Git** : `default`
