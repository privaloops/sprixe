import type { HitboxRect } from '../../types';
import type { ActionId } from '../policy/types';
import { KEN_MOVE_TIMELINES, animPtrAtFrame } from './ken-move-timelines';

/**
 * Pure ROM-driven hitbox resolver for SF2HF. Identical to the logic
 * baked into StateExtractor, extracted so the TAS forward simulator can
 * ask "where will Ken's attackbox be at frame N of his current move?"
 * without touching Work RAM.
 *
 * Source: Jesuszilla mame-rr-scripts/sf2-hitboxes.lua. Box IDs live at
 * (animPtr + id_ptr_offset) in ROM; each ID indexes into a subtable
 * whose location is (hitbox_ptr + signed_word_at(hitbox_ptr + addr_table)).
 */
export interface BoxSpec {
  kind: HitboxRect['kind'];
  /** Byte offset inside the animation frame where the box ID lives. */
  idPtr: number;
  /** Byte offset inside hitbox_ptr directory where the subtable pointer lives. */
  addrTable: number;
  /** Size of one entry in the subtable (4 for hurt/push, 12 for attack). */
  idSpace: number;
}

/** The five standard box slots per animation frame (SF2HF). */
export const SF2HF_BOX_SPECS: readonly BoxSpec[] = [
  { kind: 'push',      idPtr: 0x0D, addrTable: 0x0A, idSpace: 4 },
  { kind: 'hurt_head', idPtr: 0x08, addrTable: 0x00, idSpace: 4 },
  { kind: 'hurt_body', idPtr: 0x09, addrTable: 0x02, idSpace: 4 },
  { kind: 'hurt_legs', idPtr: 0x0A, addrTable: 0x04, idSpace: 4 },
  { kind: 'attack',    idPtr: 0x0C, addrTable: 0x08, idSpace: 12 },
];

/** Attack box slot — the one the forward simulator cares about. */
export const ATTACK_BOX_SPEC: BoxSpec = SF2HF_BOX_SPECS[4]!;

/** Size (bytes) of one animation frame struct. animPtr + N*FRAME_STRIDE
 *  addresses the Nth subsequent frame of the same animation. */
export const FRAME_STRIDE = 0x18;

/**
 * Resolve a single box (attack / hurt / push) for a given animation
 * frame pointer, returning the world-space rectangle or null when the
 * frame has no box of that kind (ID byte == 0 or degenerate radius).
 *
 *  Step 1: read box ID byte at (animPtr + spec.idPtr). 0 = no box.
 *  Step 2: read signed word at (hitboxPtr + spec.addrTable) → subtable offset.
 *  Step 3: box data lives at (hitboxPtr + subtableOffset + id * spec.idSpace).
 *          4 bytes read: val_x (i8), val_y (i8), rad_x (u8), rad_y (u8).
 *  Step 4: world rect: cx = posX + val_x * (facingLeft ? -1 : +1),
 *                     cy = posY + val_y  (SF2HF stores Y in math convention).
 */
export function resolveBoxFromRom(
  rom: Uint8Array,
  animPtr: number,
  hitboxPtr: number,
  posX: number,
  posY: number,
  facingLeft: boolean,
  spec: BoxSpec,
): HitboxRect | null {
  if (hitboxPtr === 0 || animPtr === 0) return null;
  const id = readRomByte(rom, animPtr + spec.idPtr);
  if (id === 0) return null;
  const subOff = readRomWordSigned(rom, hitboxPtr + spec.addrTable);
  const boxAddr = hitboxPtr + subOff + id * spec.idSpace;
  const valX = readRomByteSigned(rom, boxAddr);
  const valY = readRomByteSigned(rom, boxAddr + 1);
  const radX = readRomByte(rom, boxAddr + 2);
  const radY = readRomByte(rom, boxAddr + 3);
  if (radX === 0 && radY === 0) return null;
  const signX = facingLeft ? -1 : 1;
  return {
    cx: posX + valX * signX,
    cy: posY + valY,
    halfW: radX,
    halfH: radY,
    kind: spec.kind,
  };
}

/**
 * Predict Ken's attackbox at `frameOffset` frames into `action`, using
 * the empirical timeline in `ken-move-timelines.ts`.
 *
 * The naive `animPtrStart + frameOffset * 0x18` walk is WRONG — SF2HF
 * holds each ROM anim frame for a move-specific vblank count encoded
 * outside the ROM struct. The timeline records the observed sequence
 * so we can query it frame-accurately.
 *
 * Returns null if the action has no recorded timeline, frameOffset is
 * past the move's end, or the frame has no live attack hitbox.
 */
export function predictKenAttackBox(
  action: ActionId,
  frameOffset: number,
  posX: number,
  posY: number,
  facingLeft: boolean,
  hitboxPtr: number,
  rom: Uint8Array,
): HitboxRect | null {
  // jump_back_* reuses jump_forward_*'s attack animation — only the
  // velocity direction differs, the attackbox shape/offset is identical.
  const canonical = JUMP_BACK_ALIAS[action] ?? action;
  const timeline = KEN_MOVE_TIMELINES[canonical];
  if (!timeline) return null;
  const animPtr = animPtrAtFrame(timeline, frameOffset);
  if (animPtr === null) return null;
  return resolveBoxFromRom(rom, animPtr, hitboxPtr, posX, posY, facingLeft, ATTACK_BOX_SPEC);
}

const JUMP_BACK_ALIAS: Partial<Record<ActionId, ActionId>> = {
  jump_back_lp: 'jump_forward_lp',
  jump_back_mp: 'jump_forward_mp',
  jump_back_hp: 'jump_forward_hp',
  jump_back_lk: 'jump_forward_lk',
  jump_back_mk: 'jump_forward_mk',
  jump_back_hk: 'jump_forward_hk',
};

/** Read a single byte from the program ROM at the given 68k address.
 *  Returns 0 on out-of-range (safe default for missing / stale data). */
export function readRomByte(rom: Uint8Array, addr: number): number {
  const a = (addr >>> 0) & 0xFFFFFF;
  if (a >= rom.length) return 0;
  return rom[a] ?? 0;
}

function readRomByteSigned(rom: Uint8Array, addr: number): number {
  const b = readRomByte(rom, addr);
  return b & 0x80 ? b - 0x100 : b;
}

function readRomWordSigned(rom: Uint8Array, addr: number): number {
  const a = (addr >>> 0) & 0xFFFFFF;
  if (a + 1 >= rom.length) return 0;
  const hi = rom[a] ?? 0;
  const lo = rom[a + 1] ?? 0;
  const raw = (hi << 8) | lo;
  return raw & 0x8000 ? raw - 0x10000 : raw;
}
