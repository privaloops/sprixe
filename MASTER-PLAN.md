# open-arcade — MASTER PLAN

## Vision

Réinterpréter le hardware graphique des bornes d'arcade à travers les primitives du web.
Chaque sprite est un `<div>`, chaque tile un élément DOM, chaque layer un container CSS.
Le jeu tourne dans les DevTools.

Premier jeu cible : **Street Fighter II** (sf2).

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Emulation Core                  │
│  M68000 + Z80 + YM2151 + OKI6295 + Bus + VRAM  │
│              (inchangé, existant)                │
└──────────────────────┬──────────────────────────┘
                       │ lit VRAM + registres CPS-A/B
                       ▼
┌─────────────────────────────────────────────────┐
│              Video State Extractor              │
│  Extrait les données structurées par frame :    │
│  - ScrollLayer[] (tiles visibles + positions)   │
│  - Sprite[] (code, x, y, palette, flip)         │
│  - Palette[] (couleurs actives)                 │
│  - LayerOrder (priorités CPS-B)                 │
└──────────────────────┬──────────────────────────┘
                       │ données structurées (pas de pixels)
                       ▼
┌─────────────────────────────────────────────────┐
│              React DOM Renderer                  │
│  Composants React rendus dans le DOM :          │
│  <GameScreen>                                    │
│    <ScrollLayer3 style={transform} />            │
│    <ScrollLayer2 style={transform} />            │
│    <SpriteLayer />                               │
│    <ScrollLayer1 style={transform} />  (HUD)     │
│  </GameScreen>                                   │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
              Browser DOM + CSS Compositor
              (GPU-accelerated transforms)
```

---

## Phase 0 : Sprite Sheet Generator

**But :** Convertir les tiles 4bpp du GFX ROM en sprite sheets utilisables en CSS `background-image`.

### Fonctionnement

1. Au chargement de la ROM, décoder les tiles du GFX ROM (existant : `decodeRow()`)
2. Pour chaque **palette active**, générer un canvas contenant toutes les tiles de cette palette
3. Convertir en blob URL (`canvas.toBlob()` → `URL.createObjectURL()`)
4. Résultat : une map `{ [paletteIndex: number]: string }` de blob URLs

### Structure d'une sprite sheet

```
Tile 0    Tile 1    Tile 2    ...
┌────┐   ┌────┐   ┌────┐
│8x8 │   │8x8 │   │8x8 │   ← Scroll1 tiles (8x8)
└────┘   └────┘   └────┘

┌────────┐┌────────┐
│ 16x16  ││ 16x16  │              ← Scroll2 + Sprites (16x16)
└────────┘└────────┘

┌────────────────┐
│    32x32       │                 ← Scroll3 (32x32)
└────────────────┘
```

Organisées en grille, `background-position` sélectionne la tile.

### Optimisation : génération lazy

- Ne pas pré-render les 256 palettes x milliers de tiles
- Générer à la demande : quand une combo tile+palette apparaît pour la première fois
- Cache LRU pour limiter la mémoire

---

## Phase 1 : Video State Extractor

**But :** Extraire les données structurées depuis VRAM/registres, sans rendre de pixels.

### Interface de sortie

```typescript
interface TileInfo {
  code: number;        // tile code (après bank mapping)
  palette: number;     // palette index
  flipX: boolean;
  flipY: boolean;
  screenX: number;
  screenY: number;
}

interface SpriteInfo {
  code: number;
  palette: number;
  flipX: boolean;
  flipY: boolean;
  screenX: number;
  screenY: number;
  width: number;       // en tiles (1 pour single, nx pour multi)
  height: number;
}

interface ScrollLayerState {
  scrollX: number;
  scrollY: number;
  tiles: TileInfo[];
  enabled: boolean;
}

interface FrameState {
  scroll1: ScrollLayerState;
  scroll2: ScrollLayerState;
  scroll3: ScrollLayerState;
  sprites: SpriteInfo[];
  layerOrder: number[];
}
```

### Implémentation

Refactorer `cps1-video.ts` : extraire la logique de parcours des tilemaps et sprites dans des méthodes qui retournent `FrameState` au lieu de rasteriser dans un framebuffer.

Le code de parcours (tilemap scan, bank mapping, scroll registers) est réutilisé tel quel. On supprime juste la partie pixel-level (`decodeRow`, `fb32[idx] = ...`).

---

## Phase 2 : React DOM Renderer

### Composants

```
<GameScreen>                    ← position: relative, 384x224, overflow: hidden
  <Layer key={order[0]}>        ← z-index: 0
  <Layer key={order[1]}>        ← z-index: 1
  <Layer key={order[2]}>        ← z-index: 2
  <Layer key={order[3]}>        ← z-index: 3
</GameScreen>
```

#### `<Tile>` — le building block

```tsx
const Tile = React.memo(({ code, palette, x, y, size, flipX, flipY }) => (
  <div style={{
    position: 'absolute',
    left: x,
    top: y,
    width: size,
    height: size,
    backgroundImage: `url(${spriteSheets[palette]})`,
    backgroundPosition: tileToBackgroundPosition(code, size),
    transform: getFlipTransform(flipX, flipY),
    imageRendering: 'pixelated',
  }} />
));
```

#### `<ScrollLayer>` — scrolling = transform sur le container

```tsx
<div style={{
  position: 'absolute',
  inset: 0,
  transform: `translate(${-scrollX}px, ${-scrollY}px)`,
  willChange: 'transform',
}}>
  {tiles.map(tile => <Tile key={`${col}-${row}`} {...tile} />)}
</div>
```

#### `<Sprite>` — positionnement absolu dans l'écran

```tsx
const Sprite = React.memo(({ sprite }) => (
  <div style={{
    position: 'absolute',
    left: sprite.screenX,
    top: sprite.screenY,
    width: sprite.width * 16,
    height: sprite.height * 16,
    backgroundImage: `url(${spriteSheets[sprite.palette]})`,
    backgroundPosition: tileToBackgroundPosition(sprite.code, 16),
    transform: getFlipTransform(sprite.flipX, sprite.flipY),
    imageRendering: 'pixelated',
  }} />
));
```

### Correspondances hardware → CSS

| Hardware CPS1 | CSS |
|---------------|-----|
| Scroll layer X/Y offset | `transform: translate()` sur le container |
| Tile index dans la VRAM | `background-position` |
| Flip H/V | `transform: scaleX(-1) scaleY(-1)` |
| Sprite priority | `z-index` |
| Layer enable/disable | `display: none` |
| Palette swap | Swap de sprite sheet blob URL |
| Tile size 8/16/32 | `width` / `height` |
| Sprite chaining (multi-tile) | Div parent avec children positionnés |
| Transparent pen | PNG alpha dans la sprite sheet |
| Screen shake | `transform: translate()` sur le root |

---

## Phase 3 : Intégration emulator loop

```typescript
// emulator.ts
runOneFrame(): void {
  this.runM68000();
  this.runZ80Audio();

  const frameState = this.videoExtractor.extractFrame();
  this.onFrameReady(frameState);  // → React setState
}

// App.tsx
const [frame, setFrame] = useState<FrameState | null>(null);
emulator.onFrameReady = setFrame;
return <GameScreen frame={frame} spriteSheets={sheets} />;
```

Option : garder le renderer Canvas/WebGL existant comme fallback. Switch DOM/Canvas via un toggle.

---

## Phase 4 : Multi-tile sprites

Les sprites CPS1 chainent nx * ny tiles de 16x16. En DOM :

```tsx
<div style={{ position: 'absolute', left: x, top: y, width: nx*16, height: ny*16 }}>
  {subTiles.map(sub => <div style={{
    position: 'absolute',
    left: sub.offsetX,
    top: sub.offsetY,
    width: 16, height: 16,
    backgroundImage: ...,
    backgroundPosition: ...,
  }} />)}
</div>
```

---

## Phase 5 : Effets CSS bonus

| Effet | CSS | Usage |
|-------|-----|-------|
| Hit flash | `filter: brightness(3)` + `@keyframes` | Impact visuel |
| Pause | `filter: grayscale(1)` sur `<GameScreen>` | Mode pause stylisé |
| Slow-mo | `transition: transform 0.1s` sur sprites | Ralenti |
| Scanlines | `::after` + `repeating-linear-gradient` | Look CRT |
| Sprite glow | `box-shadow` | Highlight persos |
| Layer isolation | Toggle `visibility` par layer | Debug |
| Sprite tooltip | `:hover::after` avec `content` | Affiche tile code, palette |
| CSS transitions | `transition` sur position | Interpolation de mouvement |

---

## Contraintes et optimisations

### Budget DOM

| Element | Quantité max | Note |
|---------|-------------|------|
| Scroll1 (8x8) | ~1344 | HUD/texte, peu de changements par frame |
| Scroll2 (16x16) | ~336 | Background principal |
| Scroll3 (32x32) | ~84 | Arrière-plan lointain |
| Sprites | ~256 | Persos, projectiles, effets |
| **Total** | **~2000** | Faisable avec React.memo |

### React

- `React.memo` sur `<Tile>` et `<Sprite>`
- Keys stables : `${layerId}-${col}-${row}` / `sprite-${index}`
- Un seul `setState(frameState)` par frame via rAF
- Pas de state par tile, tout est top-down

### Palette hot-swap

Quand le jeu change une palette (transitions, fades) :
1. Détecter via comparaison VRAM palette vs cache
2. Re-générer la sprite sheet blob URL
3. React re-render automatique (prop change sur `backgroundImage`)

---

## Stack

| Composant | Techno |
|-----------|--------|
| Renderer | React 19 + TypeScript |
| Build | Vite |
| State | `useState` + `useRef` |
| Sprite sheets | Canvas API → blob URL |
| Styling | Inline styles |
| Core emulation | TypeScript existant |
| Audio | AudioWorklet existant |

---

## Plan d'exécution

| Phase | Description |
|-------|-------------|
| 0 | Sprite Sheet Generator : GFX ROM + palette → blob URL |
| 1 | Video State Extractor : refactor cps1-video.ts → `FrameState` |
| 2 | React DOM Renderer : `<ScrollLayer>`, `<Tile>`, `<Sprite>` |
| 3 | Intégration emulator loop : le jeu tourne en DOM |
| 4 | Multi-tile sprites : SF2 complet |
| 5 | Effets CSS + DevTools polish : le wow factor |

---

## Le pitch

Ouvrir SF2 dans Chrome. Ouvrir DevTools. Tab Elements.
Voir chaque sprite de Ryu comme un `<div>` avec sa `background-position`.
Hover le hadouken : highlight dans le jeu.
Modifier le CSS d'un sprite en live : le voir bouger dans le jeu.

**Le premier émulateur arcade où le jeu EST le DOM.**
