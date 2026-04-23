import type { GameState, CharacterState, CPUState, CharacterId, RoundPhase, HitboxRect } from '../types';
import { SF2HF_MEMORY_MAP, CHARACTER_ID_TABLE, type MemoryAddress } from './sf2hf-memory-map';
import { resolveBoxFromRom, readRomByte, SF2HF_BOX_SPECS } from '../agent/tas/box-predictor';

const WORK_RAM_BASE = 0xFF0000;
const EMPTY_ROM = new Uint8Array(0);

// Animation frame metadata offsets (inside the 24-byte struct pointed to
// by animPtr in ROM). Source: SMW Central SF2 Research thread + sf2platinum.
const ANIM_META_BLOCK_TYPE = 0x11;  // 0=none, 1=standing block, 2=crouching block
const ANIM_META_POSTURE    = 0x13;  // 0=standing, 1=crouching
const ANIM_META_YOKE2      = 0x16;  // 0=startup/active, 1=recovery
const ANIM_META_YOKE       = 0x17;  // FF=stand/walk, 17=neutral jump, 06=fwd/back jump

// In SF2HF every character has the same max health. The `p*_max_hp`
// addresses sitting right after the HP word don't actually hold this
// value — they read garbage. Use the constant instead.
const SF2HF_MAX_HP = 144;

/**
 * Reads a Work RAM Uint8Array (64KB, mapped to 0xFF0000-0xFFFFFF) and
 * extracts a typed GameState snapshot for SF2 Hyper Fighting.
 *
 * 68000 is big-endian: MSB at lower address.
 */
export class StateExtractor {
  private frameIdx = 0;

  extract(workRam: Uint8Array, nowMs: number, programRom?: Uint8Array): GameState {
    const rom = programRom ?? EMPTY_ROM;
    const p1 = this.readCharacterState(workRam, rom, 'p1');
    const p2Base = this.readCharacterState(workRam, rom, 'p2');
    const p2: CPUState = {
      ...p2Base,
      aiState: 'unknown',
      chargeCounter: this.readU16(workRam, SF2HF_MEMORY_MAP.p2_charge_ctr),
      retreatCounter: 0,
      lastSpecialFrame: -1,
    };

    const state: GameState = {
      frameIdx: this.frameIdx++,
      timestampMs: nowMs,
      p1,
      p2,
      timer: this.readTimer(workRam),
      // round_number / round_phase addresses are still `todo` in the
      // memory map — expose safe defaults so the detector doesn't
      // false-fire a round_start on 0xFF.
      roundNumber: 1,
      roundPhase: 'fight',
      cameraX: this.readU16Signed(workRam, SF2HF_MEMORY_MAP.camera_x),
    };

    return state;
  }

  reset(): void {
    this.frameIdx = 0;
  }

  private readCharacterState(workRam: Uint8Array, rom: Uint8Array, side: 'p1' | 'p2'): CharacterState {
    const map = SF2HF_MEMORY_MAP;
    const hpAddr = side === 'p1' ? map.p1_hp : map.p2_hp;
    // maxHpAddr unused — we hard-code 144 until we find the real field.
    const xAddr = side === 'p1' ? map.p1_x : map.p2_x;
    const yAddr = side === 'p1' ? map.p1_y : map.p2_y;
    const charAddr = side === 'p1' ? map.p1_char_id : map.p2_char_id;
    const animAddr = side === 'p1' ? map.p1_anim_state : map.p2_anim_state;
    const stunAddr = side === 'p1' ? map.p1_stun : map.p2_stun;
    const comboAddr = side === 'p1' ? map.p1_combo : map.p2_combo;
    const animPtrAddr = side === 'p1' ? map.p1_anim_ptr : map.p2_anim_ptr;
    const stateAddr = side === 'p1' ? map.p1_state : map.p2_state;
    const attackingAddr = side === 'p1' ? map.p1_attacking : map.p2_attacking;
    const posYAddr = side === 'p1' ? map.p1_pos_y : map.p2_pos_y;
    const flipXAddr = side === 'p1' ? map.p1_flip_x : map.p2_flip_x;
    const hitboxPtrAddr = side === 'p1' ? map.p1_hitbox_ptr : map.p2_hitbox_ptr;

    // The byte at player_base+0xA turns out to be an animation index, not
    // a pure jump-height counter (it reads non-zero during ground actions
    // too). Keep it exposed as `animState`, but expose `y` as 0 until we
    // locate the real vertical-position address.
    const y = 0;
    const animState = this.readU8(workRam, yAddr) || this.readU8(workRam, animAddr);

    const hpRaw = this.readU16(workRam, hpAddr);
    const maxHp = SF2HF_MAX_HP;
    const hp = hpRaw > maxHp ? 0 : hpRaw;
    const animPtr = this.readU32BE(workRam, animPtrAddr);
    const hitboxPtr = this.readU32BE(workRam, hitboxPtrAddr);
    const posX = this.readU16(workRam, xAddr);
    const posY = this.readU16Signed(workRam, posYAddr);
    const facingLeft = this.readU8(workRam, flipXAddr) === 0x01;

    // Resolve the 5 box specs for this frame. Each returns HitboxRect or null.
    const boxes: Array<HitboxRect | null> = SF2HF_BOX_SPECS.map((spec) =>
      resolveBoxFromRom(rom, animPtr, hitboxPtr, posX, posY, facingLeft, spec),
    );
    const hurtboxes = boxes.filter((b) => b !== null && b.kind.startsWith('hurt')) as HitboxRect[];
    const attackbox = (boxes.find((b) => b?.kind === 'attack') ?? null) as HitboxRect | null;
    const pushbox = (boxes.find((b) => b?.kind === 'push') ?? null) as HitboxRect | null;

    // Dereference animPtr into ROM to read per-frame metadata. The animPtr
    // is a 68k address in the 0x000000-0x3FFFFF range; ROM is mirrored 1:1.
    const yoke     = readRomByte(rom, animPtr + ANIM_META_YOKE);
    const yoke2    = readRomByte(rom, animPtr + ANIM_META_YOKE2);
    const posture  = readRomByte(rom, animPtr + ANIM_META_POSTURE);
    const blockMeta = readRomByte(rom, animPtr + ANIM_META_BLOCK_TYPE);

    // Derived booleans. yoke 0x17 = neutral jump, 0x06 = forward/back jump,
    // anything else non-0xFF indicates airborne too (defensive default).
    const isAirborne = yoke === 0x17 || yoke === 0x06;
    const isCrouching = posture === 0x01;
    const isRecovery = yoke2 === 0x01;

    return {
      hp,
      maxHp,
      x: posX,
      y,
      charId: this.decodeCharacterId(this.readU8(workRam, charAddr)),
      animState,
      stunCounter: this.readU16(workRam, stunAddr),
      comboCount: this.readU8(workRam, comboAddr),
      isBlocking: blockMeta !== 0x00,
      isJumping: isAirborne,
      isCrouching,
      isAirborne,
      animPtr,
      stateByte: this.readU8(workRam, stateAddr),
      attacking: this.readU8(workRam, attackingAddr) === 0x01,
      yoke,
      yoke2,
      isRecovery,
      posY,
      facingLeft,
      hurtboxes,
      attackbox,
      pushbox,
      hitboxPtr,
    };
  }

  private decodeCharacterId(raw: number): CharacterId {
    return CHARACTER_ID_TABLE[raw] ?? 'unknown';
  }

  private readTimer(workRam: Uint8Array): number {
    const raw = this.readU8(workRam, SF2HF_MEMORY_MAP.timer);
    return ((raw >> 4) & 0xF) * 10 + (raw & 0xF);
  }

  private readRoundPhase(workRam: Uint8Array): RoundPhase {
    const raw = this.readU8(workRam, SF2HF_MEMORY_MAP.round_phase);
    switch (raw) {
      case 0: return 'intro';
      case 1: return 'fight';
      case 2: return 'ko';
      case 3: return 'outro';
      default: return 'fight';
    }
  }

  private readU8(workRam: Uint8Array, addr: MemoryAddress): number {
    const off = addr.offset - WORK_RAM_BASE;
    if (off < 0 || off >= workRam.length) return 0;
    return workRam[off] ?? 0;
  }

  private readU16(workRam: Uint8Array, addr: MemoryAddress): number {
    const off = addr.offset - WORK_RAM_BASE;
    if (off < 0 || off + 1 >= workRam.length) return 0;
    return ((workRam[off] ?? 0) << 8) | (workRam[off + 1] ?? 0);
  }

  private readU16Signed(workRam: Uint8Array, addr: MemoryAddress): number {
    const raw = this.readU16(workRam, addr);
    return raw & 0x8000 ? raw - 0x10000 : raw;
  }

  private readU32BE(workRam: Uint8Array, addr: MemoryAddress): number {
    const off = addr.offset - WORK_RAM_BASE;
    if (off < 0 || off + 3 >= workRam.length) return 0;
    // Use unsigned right-shift trick to keep the result in the 32-bit
    // range (bitwise OR of four shifted bytes would otherwise sign-extend).
    return (
      ((workRam[off] ?? 0) * 0x1000000) +
      ((workRam[off + 1] ?? 0) << 16) +
      ((workRam[off + 2] ?? 0) << 8) +
      (workRam[off + 3] ?? 0)
    ) >>> 0;
  }
}
