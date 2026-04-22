import type { CharacterState, HitboxRect } from '../../types';

export type AttackHeight = 'overhead' | 'mid' | 'low';

export interface AABB {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function rectToAabb(r: HitboxRect): AABB {
  return {
    left: r.cx - r.halfW,
    right: r.cx + r.halfW,
    top: r.cy - r.halfH,
    bottom: r.cy + r.halfH,
  };
}

/** Signed separation gap (px). Negative = currently overlapping by |gap|. */
export function aabbGap(a: AABB, b: AABB): number {
  const dx = Math.max(a.left - b.right, b.left - a.right);
  const dy = Math.max(a.top - b.bottom, b.top - a.bottom);
  return Math.max(dx, dy);
}

export function aabbOverlap(a: AABB, b: AABB, gapPx = 0): boolean {
  return aabbGap(a, b) <= gapPx;
}

/** Union AABB of the target's hurtboxes, or null if none. */
export function hurtboxUnion(target: CharacterState): AABB | null {
  const boxes = target.hurtboxes ?? [];
  if (boxes.length === 0) return null;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const b of boxes) {
    const aabb = rectToAabb(b);
    if (aabb.left < left) left = aabb.left;
    if (aabb.right > right) right = aabb.right;
    if (aabb.top < top) top = aabb.top;
    if (aabb.bottom > bottom) bottom = aabb.bottom;
  }
  return { left, right, top, bottom };
}

/** Smallest gap between the attack rect and any individual hurtbox. */
export function minGapToHurtboxes(attack: HitboxRect, target: CharacterState): number | null {
  const boxes = target.hurtboxes ?? [];
  if (boxes.length === 0) return null;
  const atk = rectToAabb(attack);
  let best = Infinity;
  for (const b of boxes) {
    const g = aabbGap(atk, rectToAabb(b));
    if (g < best) best = g;
  }
  return best;
}

/**
 * Classify attack height vs target's hurtbox column. Screen Y grows down.
 *
 *   overhead — attack center above the head hurtbox top (must stand-block)
 *   low      — attack center at legs level, below body midpoint (must crouch-block)
 *   mid      — everything in between (either block orientation defends it)
 */
export function classifyAttackHeight(attack: HitboxRect, target: CharacterState): AttackHeight {
  const boxes = target.hurtboxes ?? [];
  if (boxes.length === 0) return 'mid';
  const head = boxes.find((b) => b.kind === 'hurt_head');
  const legs = boxes.find((b) => b.kind === 'hurt_legs');
  const body = boxes.find((b) => b.kind === 'hurt_body');

  const headTop = head ? head.cy - head.halfH : null;
  const bodyMid = body ? body.cy : null;
  const legsMid = legs ? legs.cy : null;

  if (headTop !== null && attack.cy < headTop - 4) return 'overhead';
  if (legsMid !== null && bodyMid !== null && attack.cy > bodyMid + (legsMid - bodyMid) * 0.5) return 'low';
  return 'mid';
}

/** Horizontal pushbox gap for grab detection. Null if either pushbox missing. */
export function pushboxHorizontalGap(a: CharacterState, b: CharacterState): number | null {
  if (!a.pushbox || !b.pushbox) return null;
  const ax = rectToAabb(a.pushbox);
  const bx = rectToAabb(b.pushbox);
  return Math.max(ax.left - bx.right, bx.left - ax.right);
}
