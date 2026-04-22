import { describe, it, expect } from 'vitest';
import type { CharacterState, HitboxRect } from '../types';
import {
  aabbGap,
  aabbOverlap,
  classifyAttackHeight,
  hurtboxUnion,
  minGapToHurtboxes,
  pushboxHorizontalGap,
  rectToAabb,
} from '../agent/policy/threat-geometry';

function rect(cx: number, cy: number, halfW: number, halfH: number, kind: HitboxRect['kind']): HitboxRect {
  return { cx, cy, halfW, halfH, kind };
}

function charStub(overrides: Partial<CharacterState> = {}): CharacterState {
  return {
    hp: 144, maxHp: 144, x: 200, y: 0, charId: 'ken',
    animState: 0, stunCounter: 0, comboCount: 0,
    isBlocking: false, isJumping: false, isCrouching: false, isAirborne: false,
    animPtr: 0, stateByte: 0, attacking: false, yoke: 0xFF, yoke2: 0,
    isRecovery: false, hurtboxes: [], attackbox: null, pushbox: null,
    ...overrides,
  };
}

describe('aabbGap / aabbOverlap', () => {
  it('returns negative gap when rectangles overlap', () => {
    const a = rectToAabb(rect(0, 0, 10, 10, 'attack'));
    const b = rectToAabb(rect(5, 0, 10, 10, 'hurt_body'));
    expect(aabbGap(a, b)).toBeLessThan(0);
    expect(aabbOverlap(a, b)).toBe(true);
  });

  it('returns positive gap when separated horizontally', () => {
    const a = rectToAabb(rect(0, 0, 10, 10, 'attack'));
    const b = rectToAabb(rect(30, 0, 5, 10, 'hurt_body'));
    expect(aabbGap(a, b)).toBe(15);
    expect(aabbOverlap(a, b, 10)).toBe(false);
    expect(aabbOverlap(a, b, 20)).toBe(true);
  });
});

describe('hurtboxUnion / minGapToHurtboxes', () => {
  it('returns null when no hurtboxes', () => {
    expect(hurtboxUnion(charStub())).toBeNull();
  });

  it('picks the smallest gap across head/body/legs', () => {
    const target = charStub({
      hurtboxes: [
        rect(100, 50, 10, 10, 'hurt_head'),
        rect(100, 80, 15, 20, 'hurt_body'),
        rect(100, 110, 15, 10, 'hurt_legs'),
      ],
    });
    const attack = rect(80, 80, 5, 5, 'attack');
    // gap to body = (85) - (100-15) = 0
    expect(minGapToHurtboxes(attack, target)).toBe(0);
  });
});

describe('classifyAttackHeight', () => {
  const target = charStub({
    hurtboxes: [
      rect(100, 50, 10, 10, 'hurt_head'),  // top = 40
      rect(100, 80, 15, 20, 'hurt_body'),  // mid = 80
      rect(100, 110, 15, 10, 'hurt_legs'), // mid = 110
    ],
  });

  it('flags overhead when cy is above head top', () => {
    expect(classifyAttackHeight(rect(100, 20, 5, 5, 'attack'), target)).toBe('overhead');
  });

  it('flags low when cy is past the midpoint between body and legs', () => {
    expect(classifyAttackHeight(rect(100, 105, 5, 5, 'attack'), target)).toBe('low');
  });

  it('flags mid in between', () => {
    expect(classifyAttackHeight(rect(100, 80, 5, 5, 'attack'), target)).toBe('mid');
  });
});

describe('pushboxHorizontalGap', () => {
  it('returns null when either pushbox missing', () => {
    expect(pushboxHorizontalGap(charStub(), charStub())).toBeNull();
  });

  it('computes horizontal separation', () => {
    const a = charStub({ pushbox: rect(100, 0, 10, 20, 'push') });
    const b = charStub({ pushbox: rect(130, 0, 10, 20, 'push') });
    expect(pushboxHorizontalGap(a, b)).toBe(10);
  });
});
