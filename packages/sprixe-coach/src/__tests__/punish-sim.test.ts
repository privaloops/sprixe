import { describe, it, expect } from 'vitest';
import {
  simulateOption,
  type BoxRel,
  type KenSnapshot,
  type OpponentSnapshot,
  type PunishOption,
  type TrajectoryMap,
  type TrajectorySample,
} from '../agent/tas/punish-sim';
import { SF2HF_BOX_SPECS, ATTACK_BOX_SPEC, FRAME_STRIDE } from '../agent/tas/box-predictor';

/**
 * Synthetic ROM scaffolding for interception tests. Builds a Ryu
 * `sweep` anim frame struct at a known address with one configured
 * attackbox + one hurtbox entry per stride, so the simulator's linear
 * stride walk reads meaningful values.
 *
 * Layout:
 *   animPtr base       = 0x10000
 *   hitboxPtr base     = 0x20000
 *   each stride adds FRAME_STRIDE bytes to animPtr
 *   box subtables live at fixed offsets from hitboxPtr
 */
const RYU_ANIM_BASE = 0x10000;
const RYU_HITBOX_PTR = 0x20000;
const ROM_SIZE = 0x30000;

function makeRom(): Uint8Array {
  return new Uint8Array(ROM_SIZE);
}

function writeSignedWordBE(rom: Uint8Array, addr: number, value: number): void {
  const raw = value < 0 ? value + 0x10000 : value;
  rom[addr] = (raw >> 8) & 0xFF;
  rom[addr + 1] = raw & 0xFF;
}

interface BoxValues {
  valX: number;
  valY: number;
  radX: number;
  radY: number;
}

/**
 * Stamp an opponent move's boxes into the synthetic ROM. All frames
 * of the move are initialised with the same data unless overriden.
 * Boxes are keyed by kind:
 *   'attack'      → id byte at animPtr + ATTACK_BOX_SPEC.idPtr
 *   'hurt_legs'   → id byte at animPtr + hurtLegsSpec.idPtr
 * The subtable offsets are hard-wired at hitboxPtr + addrTable.
 */
function stampMove(
  rom: Uint8Array,
  framesCount: number,
  boxes: { attack?: BoxValues; hurtLegs?: BoxValues; hurtBody?: BoxValues },
): void {
  // Set up subtable pointers — we use offset 0x100 for each spec so
  // box data lives at 0x20100, 0x20200 etc.
  for (const spec of SF2HF_BOX_SPECS) {
    writeSignedWordBE(rom, RYU_HITBOX_PTR + spec.addrTable, 0x100);
  }
  for (let f = 0; f < framesCount; f++) {
    const ptr = RYU_ANIM_BASE + f * FRAME_STRIDE;
    if (boxes.attack) {
      rom[ptr + ATTACK_BOX_SPEC.idPtr] = 1;
      writeBox(rom, RYU_HITBOX_PTR + 0x100 + 1 * ATTACK_BOX_SPEC.idSpace, boxes.attack);
    }
    if (boxes.hurtLegs) {
      const spec = SF2HF_BOX_SPECS.find((s) => s.kind === 'hurt_legs')!;
      rom[ptr + spec.idPtr] = 2;
      writeBox(rom, RYU_HITBOX_PTR + 0x100 + 2 * spec.idSpace, boxes.hurtLegs);
    }
    if (boxes.hurtBody) {
      const spec = SF2HF_BOX_SPECS.find((s) => s.kind === 'hurt_body')!;
      rom[ptr + spec.idPtr] = 3;
      writeBox(rom, RYU_HITBOX_PTR + 0x100 + 3 * spec.idSpace, boxes.hurtBody);
    }
  }
}

function writeBox(rom: Uint8Array, addr: number, b: BoxValues): void {
  rom[addr] = b.valX & 0xFF;
  rom[addr + 1] = b.valY & 0xFF;
  rom[addr + 2] = b.radX;
  rom[addr + 3] = b.radY;
}

/**
 * Minimal trajectory builder for a Ken move. We pad frames 0..startup-1
 * with no attackbox (Ken still in startup pose), then the active
 * frames carry the captured attackbox. Position stays put (dx=0, dy=0)
 * — faithful to grounded normals which don't move Ken much.
 */
function buildKenTraj(args: {
  startup: number;
  active: number;
  recovery: number;
  atkRel: BoxRel;
  hurtBody: BoxRel;
}): TrajectorySample[] {
  const { startup, active, recovery, atkRel, hurtBody } = args;
  const total = startup + active + recovery;
  const samples: TrajectorySample[] = [];
  for (let f = 0; f < total; f++) {
    const inActive = f >= startup && f < startup + active;
    samples.push({
      frame: f,
      dx: 0,
      dy: 0,
      attackbox: inActive ? atkRel : null,
      hurtboxes: [hurtBody],
      pushbox: null,
    });
  }
  return samples;
}

// Reusable defaults ──────────────────────────────────────────────────
const KEN_BODY: BoxRel = { cx: 0, cy: 40, halfW: 16, halfH: 40, kind: 'hurt_body' };
const KEN_CHP_ATK: BoxRel = { cx: -33, cy: 30, halfW: 19, halfH: 20, kind: 'attack' };
//                                        ^ trajectories store cx negative when captured facing-left.
const KEN_SWEEP_ATK: BoxRel = { cx: -58, cy: 10, halfW: 43, halfH: 12, kind: 'attack' };

function kenChpOption(): PunishOption {
  return { id: 'solo_chp', sequence: ['crouch_fierce'], damage: 17, notes: '' };
}
function kenSweepOption(): PunishOption {
  return { id: 'solo_sweep', sequence: ['sweep'], damage: 21, notes: '' };
}
function blockOption(): PunishOption {
  return { id: 'defend_block_crouch', sequence: ['block_crouch'], damage: 0, notes: '' };
}
function evadeOption(): PunishOption {
  return { id: 'evade_jback', sequence: ['jump_back'], damage: 0, notes: '' };
}
function comboOption(): PunishOption {
  return { id: 'combo_chp_dpHP', sequence: ['crouch_fierce', 'shoryu_fierce'], damage: 35, notes: '' };
}

describe('simulateOption — mono-hit interceptions', () => {
  it('Ken cHP connects on Ryu sweep when in range, takes zero damage', () => {
    const rom = makeRom();
    // Setup geometry:
    //   Ryu at x=500 facing right → attackbox valX=20 halfW=15 reaches
    //   out to world x=535 (short sweep tip). Leg hurtbox extends
    //   further out at world x=[505, 555].
    //   Ken at x=600 facing left → cHP attackbox projects to world
    //   cx=567, halfW=19 → left edge 548. Overlaps Ryu leg hurtbox
    //   (ends at 555) while Ryu attackbox (ends at 535) is safely
    //   13px away from Ken body (left edge 584).
    stampMove(rom, 40, {
      attack: { valX: 20, valY: 10, radX: 15, radY: 10 },
      hurtLegs: { valX: 30, valY: 10, radX: 25, radY: 15 },
    });
    const trajectories: TrajectoryMap = {
      crouch_fierce: buildKenTraj({
        startup: 5, active: 8, recovery: 17,
        atkRel: KEN_CHP_ATK,
        hurtBody: KEN_BODY,
      }),
    };
    const opponent: OpponentSnapshot = {
      x: 500, y: 0, facingLeft: false,
      animPtrAtMoveStart: RYU_ANIM_BASE,
      framesSinceMoveStart: 0,
      moveName: 'sweep',
      hitboxPtr: RYU_HITBOX_PTR,
    };
    const ken: KenSnapshot = { x: 600, y: 0, facingLeft: true, hp: 144 };
    const res = simulateOption(kenChpOption(), opponent, ken, trajectories, rom);
    expect(res.connects).toBe(true);
    expect(res.connectFrame).not.toBeNull();
    // cHP active starts at LATENCY(2) + startup(5) = 7.
    expect(res.connectFrame!).toBeGreaterThanOrEqual(7);
    expect(res.kenDamageTaken).toBe(0);
  });

  it('Ken cHP whiffs when Ryu is far out of range', () => {
    const rom = makeRom();
    stampMove(rom, 40, {
      attack: { valX: 40, valY: 10, radX: 20, radY: 10 },
      hurtLegs: { valX: 10, valY: 10, radX: 15, radY: 15 },
    });
    const trajectories: TrajectoryMap = {
      crouch_fierce: buildKenTraj({
        startup: 5, active: 8, recovery: 17,
        atkRel: KEN_CHP_ATK, hurtBody: KEN_BODY,
      }),
    };
    const opponent: OpponentSnapshot = {
      x: 200, y: 0, facingLeft: false,
      animPtrAtMoveStart: RYU_ANIM_BASE,
      framesSinceMoveStart: 0,
      moveName: 'sweep',
      hitboxPtr: RYU_HITBOX_PTR,
    };
    const ken: KenSnapshot = { x: 700, y: 0, facingLeft: true, hp: 144 };
    const res = simulateOption(kenChpOption(), opponent, ken, trajectories, rom);
    expect(res.connects).toBe(false);
    expect(res.reason).toContain('whiff');
  });

  it('Ken sweep vs Ryu sweep — connects when leg reach matches', () => {
    const rom = makeRom();
    stampMove(rom, 40, {
      attack: { valX: 40, valY: 10, radX: 20, radY: 10 },
      hurtLegs: { valX: 10, valY: 10, radX: 30, radY: 15 },
    });
    const trajectories: TrajectoryMap = {
      sweep: buildKenTraj({
        startup: 8, active: 6, recovery: 24,
        atkRel: KEN_SWEEP_ATK,
        hurtBody: { cx: 0, cy: 15, halfW: 20, halfH: 15, kind: 'hurt_legs' },
      }),
    };
    const opponent: OpponentSnapshot = {
      x: 500, y: 0, facingLeft: false,
      animPtrAtMoveStart: RYU_ANIM_BASE,
      framesSinceMoveStart: 0,
      moveName: 'sweep',
      hitboxPtr: RYU_HITBOX_PTR,
    };
    const ken: KenSnapshot = { x: 600, y: 0, facingLeft: true, hp: 144 };
    const res = simulateOption(kenSweepOption(), opponent, ken, trajectories, rom);
    expect(res.connects).toBe(true);
  });

  it('block_crouch option: no connection, no damage, safe fallback reason', () => {
    const rom = makeRom();
    const opponent: OpponentSnapshot = {
      x: 500, y: 0, facingLeft: false,
      animPtrAtMoveStart: RYU_ANIM_BASE,
      framesSinceMoveStart: 0,
      moveName: 'sweep',
      hitboxPtr: RYU_HITBOX_PTR,
    };
    const ken: KenSnapshot = { x: 560, y: 0, facingLeft: true, hp: 144 };
    const res = simulateOption(blockOption(), opponent, ken, {}, rom);
    expect(res.connects).toBe(false);
    expect(res.kenDamageTaken).toBe(0);
    expect(res.reason).toContain('block');
  });

  it('jump_back option: no connection, zero damage, evasion reason', () => {
    const rom = makeRom();
    const opponent: OpponentSnapshot = {
      x: 500, y: 0, facingLeft: false,
      animPtrAtMoveStart: RYU_ANIM_BASE,
      framesSinceMoveStart: 0,
      moveName: 'sweep',
      hitboxPtr: RYU_HITBOX_PTR,
    };
    const ken: KenSnapshot = { x: 560, y: 0, facingLeft: true, hp: 144 };
    const res = simulateOption(evadeOption(), opponent, ken, {}, rom);
    expect(res.connects).toBe(false);
    expect(res.kenDamageTaken).toBe(0);
    expect(res.reason).toContain('evasion');
  });

  it('combo option deferred — not simulated in P2, fails with marker', () => {
    const rom = makeRom();
    const opponent: OpponentSnapshot = {
      x: 500, y: 0, facingLeft: false,
      animPtrAtMoveStart: RYU_ANIM_BASE,
      framesSinceMoveStart: 0,
      moveName: 'sweep',
      hitboxPtr: RYU_HITBOX_PTR,
    };
    const ken: KenSnapshot = { x: 560, y: 0, facingLeft: true, hp: 144 };
    const res = simulateOption(comboOption(), opponent, ken, {}, rom);
    expect(res.connects).toBe(false);
    expect(res.reason).toContain('combo');
  });

  it('unknown move (no trajectory) fails gracefully', () => {
    const rom = makeRom();
    const opponent: OpponentSnapshot = {
      x: 500, y: 0, facingLeft: false,
      animPtrAtMoveStart: RYU_ANIM_BASE,
      framesSinceMoveStart: 0,
      moveName: 'sweep',
      hitboxPtr: RYU_HITBOX_PTR,
    };
    const ken: KenSnapshot = { x: 560, y: 0, facingLeft: true, hp: 144 };
    // sequence refers to crouch_fierce but trajectories is empty
    const res = simulateOption(kenChpOption(), opponent, ken, {}, rom);
    expect(res.connects).toBe(false);
    expect(res.reason).toContain('no trajectory');
  });

  it('Ken connects but absorbs damage when opponent attackbox arrives first', () => {
    const rom = makeRom();
    // Ryu attackbox immediately live (frame 0 has id=1) with long reach
    // — will hit Ken before his cHP (startup 5f) gets out.
    stampMove(rom, 40, {
      attack: { valX: 80, valY: 30, radX: 50, radY: 10 },  // huge forward attackbox
      hurtLegs: { valX: 10, valY: 10, radX: 15, radY: 15 },
    });
    const trajectories: TrajectoryMap = {
      crouch_fierce: buildKenTraj({
        startup: 5, active: 8, recovery: 17,
        atkRel: KEN_CHP_ATK, hurtBody: KEN_BODY,
      }),
    };
    const opponent: OpponentSnapshot = {
      x: 500, y: 0, facingLeft: false,
      animPtrAtMoveStart: RYU_ANIM_BASE,
      framesSinceMoveStart: 0,
      moveName: 'sweep',
      hitboxPtr: RYU_HITBOX_PTR,
    };
    const ken: KenSnapshot = { x: 560, y: 30, facingLeft: true, hp: 144 };
    const res = simulateOption(kenChpOption(), opponent, ken, trajectories, rom);
    // Ryu attackbox arrives at world x ∈ [530, 630], overlaps Ken's
    // hurtbox before cHP active. Damage taken.
    expect(res.kenDamageTaken).toBeGreaterThan(0);
  });
});
