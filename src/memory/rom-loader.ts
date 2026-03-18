/**
 * CPS1 ROM Loader
 *
 * Loads MAME-format ROM sets from ZIP files.
 * Identifies the game by filenames, assembles program/graphics/audio/OKI ROMs,
 * and performs CPS1 graphics interleaving.
 */

import JSZip from 'jszip';

export interface RomSet {
  name: string;
  programRom: Uint8Array;
  graphicsRom: Uint8Array;
  audioRom: Uint8Array;
  okiRom: Uint8Array;
  cpsBConfig: CpsBConfig;
  gfxMapper: GfxMapperConfig;
}

interface RomFileEntry {
  name: string;
  data: Uint8Array;
}

interface RomRegionDef {
  /** Filenames in load order */
  files: string[];
  /** Total assembled size in bytes */
  size: number;
}

/** ROM_LOAD16_BYTE program ROM entry: even/odd byte pairs at specific offsets */
interface ProgramRomEntry {
  even: string;  // .e file (even bytes)
  odd: string;   // .f file (odd bytes)
  offset: number;
  size: number;
}

/** ROM_LOAD16_WORD_SWAP: single file, big-endian (no swap needed for our big-endian bus) */
interface ProgramWordSwapEntry {
  file: string;
  offset: number;
  size: number;
}

interface ProgramDef {
  entries: ProgramRomEntry[];
  wordSwapEntries?: ProgramWordSwapEntry[];
  size: number;
}

/** ROM_LOAD64_WORD graphics ROM: 4 ROMs per bank, each at a 2-byte offset in 8-byte groups */
interface GfxBankDef {
  /** 4 ROM files: at byte offsets 0, 2, 4, 6 within each 8-byte group */
  files: [string, string, string, string];
  offset: number;  // starting offset in the assembled GFX region
  romSize: number;  // size of each individual ROM file
}

interface GraphicsDef {
  banks: GfxBankDef[];
  size: number;
}

/** GFX ROM bank mapper configuration (varies per board PAL) */
export interface GfxMapperConfig {
  bankSizes: [number, number, number, number];
  ranges: { type: number; start: number; end: number; bank: number }[];
}

/** CPS-B chip configuration (varies per game/board revision) */
export interface CpsBConfig {
  /** ID register offset in CPS-B regs (-1 = no ID check) */
  idOffset: number;
  /** Expected ID value */
  idValue: number;
  /** Layer control register offset */
  layerControl: number;
  /** Priority mask register offsets [0..3] */
  priority: [number, number, number, number];
  /** Palette control register offset */
  paletteControl: number;
  /** Layer enable masks: [scroll1, scroll2, scroll3, mask3, mask4] */
  layerEnableMask: [number, number, number, number, number];
}

interface GameDef {
  name: string;
  program: ProgramDef;
  graphics: GraphicsDef;
  audio: RomRegionDef;
  oki: RomRegionDef;
  cpsBConfig: CpsBConfig;
  gfxMapper: GfxMapperConfig;
}

// ---------------------------------------------------------------------------
// Game ROM definitions (MAME naming conventions)
// ---------------------------------------------------------------------------

const GAME_DEFS: GameDef[] = [
  // Street Fighter II: The World Warrior
  // Source: MAME cps1.cpp ROM_START(sf2)
  {
    name: 'sf2',
    program: {
      entries: [
        { even: 'sf2e_30g.11e', odd: 'sf2e_37g.11f', offset: 0x00000, size: 0x20000 },
        { even: 'sf2e_31g.12e', odd: 'sf2e_38g.12f', offset: 0x40000, size: 0x20000 },
        { even: 'sf2e_28g.9e',  odd: 'sf2e_35g.9f',  offset: 0x80000, size: 0x20000 },
        { even: 'sf2_29b.10e',  odd: 'sf2_36b.10f',  offset: 0xc0000, size: 0x20000 },
      ],
      size: 0x100000,
    },
    graphics: {
      banks: [
        {
          // ROM_LOAD64_WORD offsets 0x000000, 0x000002, 0x000004, 0x000006
          files: ['sf2-5m.4a', 'sf2-7m.6a', 'sf2-1m.3a', 'sf2-3m.5a'],
          offset: 0x000000,
          romSize: 0x80000,
        },
        {
          // ROM_LOAD64_WORD offsets 0x200000, 0x200002, 0x200004, 0x200006
          files: ['sf2-6m.4c', 'sf2-8m.6c', 'sf2-2m.3c', 'sf2-4m.5c'],
          offset: 0x200000,
          romSize: 0x80000,
        },
        {
          // ROM_LOAD64_WORD offsets 0x400000, 0x400002, 0x400004, 0x400006
          files: ['sf2-13m.4d', 'sf2-15m.6d', 'sf2-9m.3d', 'sf2-11m.5d'],
          offset: 0x400000,
          romSize: 0x80000,
        },
      ],
      size: 0x600000,
    },
    audio: {
      files: ['sf2_9.12a'],
      size: 0x18000,
    },
    oki: {
      files: ['sf2_18.11c', 'sf2_19.12c'],
      size: 0x40000,
    },
    cpsBConfig: {
      idOffset: 0x32, idValue: 0x0401,
      layerControl: 0x26,
      priority: [0x28, 0x2a, 0x2c, 0x2e],
      paletteControl: 0x30,
      layerEnableMask: [0x08, 0x10, 0x20, 0x00, 0x00],
    },
    gfxMapper: {
      bankSizes: [0x8000, 0x8000, 0x8000, 0],
      ranges: [
        { type: 1, start: 0x00000, end: 0x07fff, bank: 0 },
        { type: 1, start: 0x08000, end: 0x0ffff, bank: 1 },
        { type: 1, start: 0x10000, end: 0x11fff, bank: 2 },
        { type: 8, start: 0x02000, end: 0x03fff, bank: 2 },
        { type: 2, start: 0x04000, end: 0x04fff, bank: 2 },
        { type: 4, start: 0x05000, end: 0x07fff, bank: 2 },
      ],
    },
  },

  // Final Fight
  // Source: MAME cps1.cpp ROM_START(ffight)
  {
    name: 'ffight',
    program: {
      entries: [
        { even: 'ff_36.11f',  odd: 'ff_42.11h',  offset: 0x00000, size: 0x20000 },
        { even: 'ff_37.12f',  odd: 'ffe_43.12h',  offset: 0x40000, size: 0x20000 },
      ],
      wordSwapEntries: [
        { file: 'ff-32m.8h', offset: 0x80000, size: 0x80000 },
      ],
      size: 0x100000,
    },
    graphics: {
      banks: [
        {
          files: ['ff-5m.7a', 'ff-7m.9a', 'ff-1m.3a', 'ff-3m.5a'],
          offset: 0x000000,
          romSize: 0x80000,
        },
      ],
      size: 0x200000,
    },
    audio: {
      files: ['ff_09.12b'],
      size: 0x18000,
    },
    oki: {
      files: ['ff_18.11c', 'ff_19.12c'],
      size: 0x40000,
    },
    cpsBConfig: {
      idOffset: 0x20, idValue: 0x0004,
      layerControl: 0x2e,
      priority: [0x26, 0x30, 0x28, 0x32],
      paletteControl: 0x2a,
      layerEnableMask: [0x02, 0x04, 0x08, 0x00, 0x00],
    },
    gfxMapper: {
      bankSizes: [0x8000, 0, 0, 0],
      ranges: [
        { type: 1, start: 0x0000, end: 0x43ff, bank: 0 },
        { type: 2, start: 0x4400, end: 0x4bff, bank: 0 },
        { type: 8, start: 0x4c00, end: 0x5fff, bank: 0 },
        { type: 4, start: 0x6000, end: 0x7fff, bank: 0 },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// ROM identification & loading
// ---------------------------------------------------------------------------

/** Collect all filenames referenced by a GameDef */
function getAllFiles(def: GameDef): string[] {
  const files: string[] = [];
  for (const entry of def.program.entries) {
    files.push(entry.even, entry.odd);
  }
  if (def.program.wordSwapEntries) {
    for (const entry of def.program.wordSwapEntries) {
      files.push(entry.file);
    }
  }
  for (const bank of def.graphics.banks) {
    files.push(...bank.files);
  }
  files.push(...def.audio.files, ...def.oki.files);
  return files;
}

/**
 * Identify a game from the filenames present in the ZIP archive.
 */
function identifyGame(fileNames: string[]): GameDef | null {
  const lowerNames = new Set(fileNames.map(n => n.toLowerCase()));

  let bestMatch: GameDef | null = null;
  let bestScore = 0;

  for (const def of GAME_DEFS) {
    const allFiles = getAllFiles(def);
    let score = 0;
    for (const f of allFiles) {
      if (lowerNames.has(f.toLowerCase())) {
        score++;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = def;
    }
  }

  // Require at least the program ROMs to match
  if (bestMatch !== null) {
    const progFileCount = bestMatch.program.entries.length * 2;
    if (bestScore >= progFileCount) {
      return bestMatch;
    }
  }

  return null;
}

/**
 * Extract all files from a ZIP as RomFileEntry[].
 */
async function extractZip(file: File): Promise<RomFileEntry[]> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const entries: RomFileEntry[] = [];

  const promises: Promise<void>[] = [];

  zip.forEach((relativePath, zipEntry) => {
    if (zipEntry.dir) return;
    // Strip directory prefix — MAME ROMs are sometimes nested
    const name = relativePath.includes('/')
      ? relativePath.substring(relativePath.lastIndexOf('/') + 1)
      : relativePath;

    promises.push(
      zipEntry.async('uint8array').then(data => {
        entries.push({ name, data });
      })
    );
  });

  await Promise.all(promises);
  return entries;
}

/**
 * Build a filename -> data map from the extracted entries.
 */
function buildFileMap(entries: RomFileEntry[]): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>();
  for (const entry of entries) {
    map.set(entry.name.toLowerCase(), entry.data);
  }
  return map;
}

/**
 * Concatenate ROM files into a single Uint8Array in definition order.
 */
function assembleLinear(
  files: string[],
  fileMap: Map<string, Uint8Array>,
  totalSize: number,
): Uint8Array {
  const result = new Uint8Array(totalSize);
  let offset = 0;

  for (const name of files) {
    const data = fileMap.get(name.toLowerCase());
    if (data === undefined) continue;
    const copyLen = Math.min(data.length, totalSize - offset);
    result.set(data.subarray(0, copyLen), offset);
    offset += data.length;
  }

  return result;
}

/**
 * Assemble program ROM using ROM_LOAD16_BYTE format.
 *
 * Each entry has an even file (byte 0, 2, 4...) and odd file (byte 1, 3, 5...)
 * placed at a specific offset in the final ROM.
 */
function assembleProgram(
  def: ProgramDef,
  fileMap: Map<string, Uint8Array>,
): Uint8Array {
  const result = new Uint8Array(def.size);

  for (const entry of def.entries) {
    const evenData = fileMap.get(entry.even.toLowerCase());
    const oddData = fileMap.get(entry.odd.toLowerCase());

    for (let i = 0; i < entry.size; i++) {
      const dest = entry.offset + i * 2;
      if (dest + 1 >= def.size) break;
      result[dest] = evenData !== undefined && i < evenData.length ? evenData[i]! : 0;
      result[dest + 1] = oddData !== undefined && i < oddData.length ? oddData[i]! : 0;
    }
  }

  // ROM_LOAD16_WORD_SWAP: swap bytes within each 16-bit word
  if (def.wordSwapEntries) {
    for (const entry of def.wordSwapEntries) {
      const data = fileMap.get(entry.file.toLowerCase());
      if (data !== undefined) {
        const copyLen = Math.min(data.length, entry.size, def.size - entry.offset);
        for (let i = 0; i < copyLen; i += 2) {
          result[entry.offset + i] = data[i + 1] ?? 0;
          result[entry.offset + i + 1] = data[i] ?? 0;
        }
      }
    }
  }

  return result;
}

/**
 * CPS1 graphics ROM assembly and decode.
 *
 * Step 1: ROM_LOAD64_WORD interleave.
 *   Each bank has 4 ROMs. Each ROM provides 2 bytes (word) per 8-byte group.
 *   ROM 0 → bytes 0,1; ROM 1 → bytes 2,3; ROM 2 → bytes 4,5; ROM 3 → bytes 6,7.
 *
 * Step 2: Decode to 1-byte-per-pixel using MAME's cps1_layout8x8:
 *   planeoffset = {24, 16, 8, 0}  → in each 4-byte word: byte3=plane3, byte2=plane2, byte1=plane1, byte0=plane0
 *   xoffset = STEP8(0, 1)         → bit 0=pixel 0 ... bit 7=pixel 7 (LSB = leftmost!)
 *   yoffset = STEP8(0, 64)        → each row = 64 bits = 8 bytes apart
 *   charincrement = 512 bits = 64 bytes per tile
 *
 *   So each 64-byte block in the interleaved ROM = one 8x8 tile.
 *   Each row = 8 bytes = [plane0_byte, plane1_byte, plane2_byte, plane3_byte, next_tile_plane0, ...]
 *   Wait — actually the 64-byte block contains TWO tiles side by side:
 *     Tile A uses bytes 0-3 of each row, Tile B uses bytes 4-7 (cps1_layout8x8_2).
 *   But for our renderer we decode ALL as sequential tiles, which maps correctly.
 *
 *   Per row (8 bytes): plane0=byte[0], plane1=byte[1], plane2=byte[2], plane3=byte[3]
 *   xoffset STEP8(0,1) means bit 0 = pixel 0 (leftmost), bit 7 = pixel 7 (rightmost)
 *
 * Output: 1 byte per pixel, 64 bytes per 8x8 tile. Tile N starts at N*64.
 */
function assembleGraphicsNew(
  def: GraphicsDef,
  fileMap: Map<string, Uint8Array>,
): Uint8Array {
  // Step 1: Interleave into raw buffer (same size as region)
  const raw = new Uint8Array(def.size);

  for (const bank of def.banks) {
    const roms: (Uint8Array | undefined)[] = bank.files.map(
      f => fileMap.get(f.toLowerCase())
    );

    // Each ROM is romSize bytes. It contributes 2 bytes per 8-byte group.
    // So each ROM byte-pair at offset j maps to raw[bank.offset + (j/2)*8 + romIndex*2]
    for (let j = 0; j < bank.romSize; j += 2) {
      const destBase = bank.offset + (j / 2) * 8;
      if (destBase + 7 >= def.size) break;

      for (let r = 0; r < 4; r++) {
        const rom = roms[r];
        raw[destBase + r * 2] = rom !== undefined && j < rom.length ? rom[j]! : 0;
        raw[destBase + r * 2 + 1] = rom !== undefined && j + 1 < rom.length ? rom[j + 1]! : 0;
      }
    }
  }

  // Return the raw interleaved data directly.
  // The renderer will decode pixels on-the-fly using the MAME gfx layout.
  // This avoids having to pre-decode all tiles and keeps the tile indexing
  // consistent with how the CPS1 hardware addresses graphics.
  return raw;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load a CPS1 ROM set from a ZIP file (browser File API).
 *
 * @param file - A File object from drag & drop or file input
 * @returns The assembled RomSet ready to be loaded into the emulator
 * @throws Error if the game cannot be identified or required ROMs are missing
 */
export async function loadRomFromZip(file: File): Promise<RomSet> {
  const entries = await extractZip(file);

  if (entries.length === 0) {
    throw new Error('ZIP archive is empty');
  }

  const fileNames = entries.map(e => e.name);
  const gameDef = identifyGame(fileNames);

  if (gameDef === null) {
    throw new Error(
      `Unable to identify CPS1 game. Found files: ${fileNames.join(', ')}. ` +
      `Supported games: ${GAME_DEFS.map(g => g.name).join(', ')}`
    );
  }

  const fileMap = buildFileMap(entries);

  // Verify program ROM files
  for (const entry of gameDef.program.entries) {
    if (!fileMap.has(entry.even.toLowerCase()) || !fileMap.has(entry.odd.toLowerCase())) {
      throw new Error(
        `Missing program ROM files for ${gameDef.name}: ${entry.even} or ${entry.odd}`
      );
    }
  }
  if (gameDef.program.wordSwapEntries) {
    for (const entry of gameDef.program.wordSwapEntries) {
      if (!fileMap.has(entry.file.toLowerCase())) {
        throw new Error(
          `Missing program ROM file for ${gameDef.name}: ${entry.file}`
        );
      }
    }
  }

  const programRom = assembleProgram(gameDef.program, fileMap);
  const graphicsRom = assembleGraphicsNew(gameDef.graphics, fileMap);
  // Audio ROM uses ROM_LOAD + ROM_CONTINUE format:
  // First 0x8000 bytes → offset 0x0000, next 0x8000 bytes → offset 0x10000
  const audioFileData = fileMap.get(gameDef.audio.files[0]!.toLowerCase());
  const audioRom = new Uint8Array(gameDef.audio.size);
  if (audioFileData !== undefined) {
    // ROM_LOAD: first 0x8000 bytes at offset 0x0000
    const firstChunk = Math.min(0x8000, audioFileData.length);
    audioRom.set(audioFileData.subarray(0, firstChunk), 0x0000);
    // ROM_CONTINUE: remaining bytes at offset 0x10000
    if (audioFileData.length > 0x8000) {
      const remaining = audioFileData.subarray(0x8000);
      audioRom.set(remaining, 0x10000);
    }
  }
  const okiRom = assembleLinear(gameDef.oki.files, fileMap, gameDef.oki.size);

  return {
    name: gameDef.name,
    programRom,
    graphicsRom,
    audioRom,
    okiRom,
    cpsBConfig: gameDef.cpsBConfig,
    gfxMapper: gameDef.gfxMapper,
  };
}

/**
 * Get the list of supported game names.
 */
export function getSupportedGames(): string[] {
  return GAME_DEFS.map(g => g.name);
}
