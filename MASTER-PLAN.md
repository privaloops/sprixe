# CPS1-Web — Master Plan

> Émulateur CPS1 (Capcom Play System 1) from scratch dans le browser.
> TypeScript + WebGPU + WebRTC. Zéro dépendance d'émulation.

## Vision

Un **Fightcade dans le browser** : tu ouvres une URL, tu drag & drop ta ROM, tu joues. Tu partages un lien, ton pote rejoint, vous jouez à Street Fighter II ensemble. Zéro installation.

## Architecture hardware CPS1

```
┌─────────────────────────────────────────────┐
│                  CPS1 Board                 │
│                                             │
│  ┌──────────┐    ┌──────────┐               │
│  │ M68000   │    │   Z80    │               │
│  │ 10 MHz   │◄──►│ 3.58 MHz │  (son)        │
│  │ (main)   │    └────┬─────┘               │
│  └────┬─────┘         │                     │
│       │           ┌───┴────┐  ┌──────────┐  │
│       │           │ YM2151 │  │ OKI6295  │  │
│       │           │ (FM)   │  │ (ADPCM)  │  │
│       │           └────────┘  └──────────┘  │
│  ┌────┴─────────────────────────┐           │
│  │        CPS-A / CPS-B        │           │
│  │   (custom graphics chips)    │           │
│  │                              │           │
│  │  3 scroll layers (tilemaps)  │           │
│  │  1 sprite layer (objects)    │           │
│  │  palette (32 palettes x 16)  │           │
│  │  layer priority control      │           │
│  └──────────────────────────────┘           │
│                                             │
│  ROM banks: program, graphics, audio        │
└─────────────────────────────────────────────┘
```

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Langage | TypeScript (strict) |
| Build | Vite |
| CPU 68000 | Interpréteur cycle-accurate TS |
| CPU Z80 | Interpréteur cycle-accurate TS |
| Rendu | WebGPU (fallback WebGL2) |
| Audio FM | YM2151 — synthèse logicielle via AudioWorklet |
| Audio ADPCM | OKI6295 — décodage ADPCM via AudioWorklet |
| Netplay | WebRTC DataChannels (peer-to-peer) |
| Signaling | Petit serveur WebSocket (matchmaking) |
| UI | HTML/CSS vanilla (pas de framework) |

## Modules

### 1. CPU Motorola 68000

- Jeu d'instructions complet (56 instructions, ~70 avec variantes d'adressage)
- Modes d'adressage (8 modes, sous-modes)
- Registres : D0-D7, A0-A7, SR, PC, SSP, USP
- Exceptions : interrupts (7 niveaux), bus error, address error, traps
- Timing cycle-accurate par instruction
- **Source de référence** : Motorola 68000 Programmer's Reference Manual

### 2. CPU Zilog Z80

- Jeu d'instructions complet (~158 instructions de base + préfixes CB/DD/ED/FD)
- Registres : AF, BC, DE, HL, IX, IY, SP, PC + shadow registers
- Modes d'interruption IM0, IM1, IM2
- Communication avec le 68000 via zone mémoire partagée (sound latch)
- **Source de référence** : Z80 CPU User Manual

### 3. CPS-A / CPS-B (GPU custom)

- **3 scroll layers** : tilemaps 16x16 ou 32x32, scroll X/Y indépendant
- **1 object layer** : sprites 16x16 avec chaînage multi-tile
- **Palette** : 192 entrées de 16 couleurs (12-bit RGB → 4096 couleurs)
- **Priorité** : contrôle par layer, par tile, par sprite
- **Row scroll** : scroll horizontal par ligne (effets de déformation)
- **Registres CPS-A** : contrôle scroll, base addresses des tilemaps
- **Registres CPS-B** : priorité layers, multiplication ID (protection)
- **Source de référence** : MAME `src/mame/capcom/cps1.cpp` + Jotego `jtcps1` (Verilog RTL)

### 4. Audio — YM2151 (OPM)

- Synthèse FM 4 opérateurs, 8 canaux
- Enveloppes ADSR par opérateur
- LFO (vibrato, tremolo)
- Noise generator
- Timer A/B avec interrupts vers Z80
- Sample rate : 55.93 kHz (natif) → resample vers 44.1/48 kHz
- **Implémentation** : AudioWorklet dédié, ring buffer vers main thread

### 5. Audio — OKI MSM6295

- Décodage ADPCM 4-bit → PCM
- 4 voix simultanées
- Sample rate : 7.575 kHz (variable par clock divider)
- Mixage dans le même AudioWorklet que le YM2151

### 6. Memory Map & Bus

```
68000 Memory Map:
  0x000000-0x3FFFFF : Program ROM (banked)
  0x800000-0x800xxx : CPS-A registers
  0x800100-0x8001FF : CPS-B registers
  0x900000-0x92FFFF : Graphics RAM (VRAM)
  0xFF0000-0xFFFFFF : Work RAM (64KB)
  0x800018          : Sound latch (→ Z80)

Z80 Memory Map:
  0x0000-0x7FFF : Audio ROM
  0x8000-0xBFFF : Audio ROM (banked)
  0xD000-0xD7FF : Work RAM
  0xF000        : OKI6295 data
  0xF002        : OKI6295 status
  0xF004        : Sound latch (← 68000)
  0xF006        : YM2151 address
  0xF008        : YM2151 data
```

### 7. Rendu WebGPU

- **Pipeline** : chaque frame, le CPS-A/B produit un framebuffer 384x224
- **Upload** : texture GPU mise à jour chaque frame (writeTexture)
- **Shader CRT** (fragment shader) :
  - Scanlines
  - Phosphor glow (bloom gaussien)
  - Courbure écran (barrel distortion)
  - Vignetting
  - Sous-pixels RGB
- **Fallback WebGL2** : même pipeline, shaders GLSL au lieu de WGSL

### 8. Netplay — Rollback via WebRTC

```
┌──────────┐  WebRTC DataChannel  ┌──────────┐
│ Player 1 │◄────────────────────►│ Player 2 │
│          │   (peer-to-peer)     │          │
│ Émulateur│                      │ Émulateur│
│ local    │                      │ local    │
└────┬─────┘                      └────┬─────┘
     │         ┌──────────┐            │
     └────────►│ Signaling│◄───────────┘
               │ Server   │
               │ (WS)     │
               └──────────┘
```

- **Principe rollback** :
  1. Chaque frame, envoyer ses inputs à l'autre joueur
  2. Si les inputs distants n'arrivent pas à temps → prédire (répéter le dernier input)
  3. Quand les vrais inputs arrivent → si différents de la prédiction :
     - Restaurer le save state du frame concerné
     - Rejouer les frames avec les bons inputs
     - Ré-afficher le frame courant
  4. Max rollback : 7 frames (~116ms à 60fps)
- **Pré-requis** : save state / restore state instantané (<1ms) — avantage du from scratch
- **Signaling server** : Deno ou Node, uniquement pour l'échange SDP/ICE (pas de relay)

### 9. ROM Loader

- Drag & drop de fichiers ZIP
- Parsing des ROM sets (format MAME : multiple fichiers par jeu)
- Identification par CRC32/SHA1 (table de correspondance)
- Décodage graphique : désinterleaving des tiles CPS1
- Stockage en mémoire (pas de persistance serveur)
- Support des ROM sets parent/clone

### 10. UI

- Page unique, responsive
- Zone drag & drop centrale
- Canvas plein écran (ratio 4:3 maintenu)
- Config clavier / gamepad (Gamepad API)
- Toggle shaders CRT on/off
- Netplay : bouton "Créer une partie" → génère un lien partageable
- Pas de framework, HTML/CSS/TS vanilla

## Phases de développement

### Phase 1 — CPU 68000 + écran noir
- Interpréteur 68000 complet
- Tests unitaires par instruction (comparaison avec les timings Motorola)
- Chargement ROM, exécution jusqu'au premier accès VRAM
- **Livrable** : les tests passent, le CPU tourne

### Phase 2 — Rendu tilemaps
- Memory map complet
- CPS-A registers (scroll, tile base)
- Décodage des tiles depuis la ROM graphique
- Rendu des 3 scroll layers dans un canvas 2D (pas encore WebGPU)
- **Livrable** : on voit le background de SF2

### Phase 3 — Sprites + palette
- Object layer (sprites)
- Palette complète (12-bit RGB)
- Priorité layers/sprites
- **Livrable** : les personnages apparaissent

### Phase 4 — Input + gameplay
- Lecture des ports d'entrée (joystick, boutons, coins)
- Mapping clavier → ports CPS1
- Gamepad API
- **Livrable** : on peut jouer (sans son)

### Phase 5 — Z80 + Audio
- Interpréteur Z80
- Communication 68000 ↔ Z80 (sound latch)
- YM2151 FM synthesis (AudioWorklet)
- OKI6295 ADPCM
- **Livrable** : le son fonctionne, le jeu est complet en solo

### Phase 6 — WebGPU
- Migrer le rendu canvas 2D → WebGPU
- Shaders CRT (scanlines, bloom, courbure)
- Fallback WebGL2
- **Livrable** : rendu arcade authentique

### Phase 7 — Netplay rollback
- Save state / restore state (<1ms)
- WebRTC DataChannels
- Algorithme de rollback (inspiré GGPO)
- Signaling server minimal
- UI : créer/rejoindre partie via lien
- **Livrable** : deux joueurs à distance sur SF2

### Phase 8 — Polish
- Compatibilité élargie (tester les ~130 jeux CPS1)
- Plein écran
- Sauvegarde config (localStorage)
- Save states manuels (IndexedDB)
- Latence audio minimisée
- Mobile : contrôles tactiles

## Jeux CPS1 emblématiques (cibles prioritaires)

| Jeu | Année | Intérêt |
|-----|-------|---------|
| Street Fighter II: The World Warrior | 1991 | Référence absolue |
| Street Fighter II': Champion Edition | 1992 | Le plus joué en tournoi rétro |
| Street Fighter II' Turbo: Hyper Fighting | 1992 | Version compétitive |
| Final Fight | 1989 | Beat'em up iconique |
| Ghouls'n Ghosts | 1988 | Platformer, bon test scroll |
| Strider | 1989 | Multi-scroll complexe |
| 1941: Counter Attack | 1990 | Shmup, bon test sprites |
| Mercs | 1990 | Run & gun |

## Sources de référence

| Ressource | Usage |
|-----------|-------|
| Motorola 68000 PRM | Jeu d'instructions, timings |
| Z80 CPU User Manual | Jeu d'instructions Z80 |
| MAME `src/mame/capcom/cps1.cpp` | Comportement CPS-A/CPS-B |
| Jotego `jtcps1` (GitHub) | RTL Verilog, description gate-level |
| YM2151 Application Manual | Synthèse FM, registres |
| OKI MSM6295 datasheet | ADPCM, registres |
| GGPO SDK documentation | Algorithme rollback |

## Contraintes

- **Légalité** : aucune ROM incluse. L'utilisateur fournit ses propres fichiers.
- **Performance** : budget 16ms par frame. Cible <5ms pour laisser de la marge au rollback.
- **Navigateurs** : Chrome/Edge (WebGPU natif), Firefox/Safari (fallback WebGL2).
- **Pas de backend** : tout tourne côté client sauf le signaling server pour le netplay.
