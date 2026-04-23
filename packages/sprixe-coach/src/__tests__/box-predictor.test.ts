import { describe, it, expect } from 'vitest';
import {
  resolveBoxFromRom,
  ATTACK_BOX_SPEC,
  SF2HF_BOX_SPECS,
  readRomByte,
} from '../agent/tas/box-predictor';

/**
 * These tests use a synthetic ROM buffer to exercise the pure
 * ROM-driven resolver without loading a real SF2HF program ROM.
 *
 * Layout:
 *   animPtr     = 0x100
 *   hitboxPtr   = 0x200
 *   addrTable entry at hitboxPtr + spec.addrTable → signed word 0x40
 *     → subtable base at 0x240
 *   box id 3 at animPtr + spec.idPtr
 *   box data at 0x240 + 3 * idSpace
 */
function makeRom(size = 0x2000): Uint8Array {
  return new Uint8Array(size);
}

function writeSignedWordBE(rom: Uint8Array, addr: number, value: number): void {
  const raw = value < 0 ? value + 0x10000 : value;
  rom[addr] = (raw >> 8) & 0xFF;
  rom[addr + 1] = raw & 0xFF;
}

describe('resolveBoxFromRom', () => {
  it('returns null when the box ID byte is 0 (no box this frame)', () => {
    const rom = makeRom();
    const box = resolveBoxFromRom(rom, 0x100, 0x200, 100, 50, false, ATTACK_BOX_SPEC);
    expect(box).toBeNull();
  });

  it('returns null when animPtr or hitboxPtr is 0', () => {
    const rom = makeRom();
    expect(resolveBoxFromRom(rom, 0, 0x200, 100, 50, false, ATTACK_BOX_SPEC)).toBeNull();
    expect(resolveBoxFromRom(rom, 0x100, 0, 100, 50, false, ATTACK_BOX_SPEC)).toBeNull();
  });

  it('decodes a valid attack box with signed val_x, val_y', () => {
    const rom = makeRom();
    const animPtr = 0x100;
    const hitboxPtr = 0x200;
    const id = 3;
    rom[animPtr + ATTACK_BOX_SPEC.idPtr] = id;
    writeSignedWordBE(rom, hitboxPtr + ATTACK_BOX_SPEC.addrTable, 0x40);
    const boxAddr = hitboxPtr + 0x40 + id * ATTACK_BOX_SPEC.idSpace;
    rom[boxAddr] = 20 & 0xFF;           // val_x = +20
    rom[boxAddr + 1] = (-8) & 0xFF;     // val_y = -8 (stored as 0xF8)
    rom[boxAddr + 2] = 14;              // rad_x
    rom[boxAddr + 3] = 10;              // rad_y

    const box = resolveBoxFromRom(rom, animPtr, hitboxPtr, 100, 50, false, ATTACK_BOX_SPEC);
    expect(box).not.toBeNull();
    expect(box!.cx).toBe(120);
    expect(box!.cy).toBe(42);
    expect(box!.halfW).toBe(14);
    expect(box!.halfH).toBe(10);
    expect(box!.kind).toBe('attack');
  });

  it('mirrors val_x when facingLeft is true', () => {
    const rom = makeRom();
    const animPtr = 0x100;
    const hitboxPtr = 0x200;
    const id = 1;
    rom[animPtr + ATTACK_BOX_SPEC.idPtr] = id;
    writeSignedWordBE(rom, hitboxPtr + ATTACK_BOX_SPEC.addrTable, 0x40);
    const boxAddr = hitboxPtr + 0x40 + id * ATTACK_BOX_SPEC.idSpace;
    rom[boxAddr] = 22;       // val_x = +22
    rom[boxAddr + 1] = 0;
    rom[boxAddr + 2] = 10;
    rom[boxAddr + 3] = 10;

    const right = resolveBoxFromRom(rom, animPtr, hitboxPtr, 100, 50, false, ATTACK_BOX_SPEC);
    const left  = resolveBoxFromRom(rom, animPtr, hitboxPtr, 100, 50, true,  ATTACK_BOX_SPEC);
    expect(right!.cx).toBe(122);
    expect(left!.cx).toBe(78);
  });

  it('rejects degenerate boxes (rad_x = rad_y = 0)', () => {
    const rom = makeRom();
    const animPtr = 0x100;
    const hitboxPtr = 0x200;
    rom[animPtr + ATTACK_BOX_SPEC.idPtr] = 2;
    writeSignedWordBE(rom, hitboxPtr + ATTACK_BOX_SPEC.addrTable, 0x40);
    const boxAddr = hitboxPtr + 0x40 + 2 * ATTACK_BOX_SPEC.idSpace;
    rom[boxAddr] = 10;
    rom[boxAddr + 1] = 10;
    rom[boxAddr + 2] = 0;
    rom[boxAddr + 3] = 0;

    expect(resolveBoxFromRom(rom, animPtr, hitboxPtr, 0, 0, false, ATTACK_BOX_SPEC)).toBeNull();
  });

  it('handles out-of-range reads without throwing', () => {
    const rom = makeRom(0x100);
    expect(() => resolveBoxFromRom(rom, 0x200, 0x300, 0, 0, false, ATTACK_BOX_SPEC)).not.toThrow();
    // Out-of-range id read yields 0 → null.
    expect(resolveBoxFromRom(rom, 0x200, 0x300, 0, 0, false, ATTACK_BOX_SPEC)).toBeNull();
  });

  it('handles signed negative val_x (i8 with high bit set)', () => {
    const rom = makeRom();
    const animPtr = 0x100;
    const hitboxPtr = 0x200;
    rom[animPtr + ATTACK_BOX_SPEC.idPtr] = 1;
    writeSignedWordBE(rom, hitboxPtr + ATTACK_BOX_SPEC.addrTable, 0x40);
    const boxAddr = hitboxPtr + 0x40 + 1 * ATTACK_BOX_SPEC.idSpace;
    rom[boxAddr] = (-30) & 0xFF;   // val_x = -30
    rom[boxAddr + 1] = 0;
    rom[boxAddr + 2] = 5;
    rom[boxAddr + 3] = 5;

    const box = resolveBoxFromRom(rom, animPtr, hitboxPtr, 100, 0, false, ATTACK_BOX_SPEC);
    expect(box!.cx).toBe(70);
  });

  it('exposes all 5 SF2HF slot kinds in SF2HF_BOX_SPECS', () => {
    const kinds = SF2HF_BOX_SPECS.map((s) => s.kind);
    expect(kinds).toContain('attack');
    expect(kinds).toContain('push');
    expect(kinds).toContain('hurt_head');
    expect(kinds).toContain('hurt_body');
    expect(kinds).toContain('hurt_legs');
  });
});

// predictKenAttackBox is now timeline-driven; tested via animPtrAtFrame
// in ken-move-timelines.test.ts (pure function, no ROM fixture needed).

describe('readRomByte', () => {
  it('returns 0 for out-of-range addresses', () => {
    const rom = new Uint8Array(0x10);
    expect(readRomByte(rom, 0x1000)).toBe(0);
  });
});
