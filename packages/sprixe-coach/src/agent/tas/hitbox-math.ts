import type { HitboxRect } from '../../types';

/** True if two axis-aligned rectangles overlap. Pixel-perfect AABB test.
 *  Matches what the SF2 engine itself does on every frame. */
export function rectsOverlap(a: HitboxRect, b: HitboxRect): boolean {
  const aLeft = a.cx - a.halfW;
  const aRight = a.cx + a.halfW;
  const aTop = a.cy - a.halfH;
  const aBottom = a.cy + a.halfH;
  const bLeft = b.cx - b.halfW;
  const bRight = b.cx + b.halfW;
  const bTop = b.cy - b.halfH;
  const bBottom = b.cy + b.halfH;
  return aLeft <= bRight && aRight >= bLeft && aTop <= bBottom && aBottom >= bTop;
}

/** True if the attacker's current active attackbox overlaps ANY of the
 *  target's hurtboxes. I.e. the attack is currently connecting. */
export function attackHitsAny(
  attacker: { attackbox?: HitboxRect | null },
  target: { hurtboxes?: HitboxRect[] },
): boolean {
  const atk = attacker.attackbox;
  if (!atk) return false;
  const hurts = target.hurtboxes ?? [];
  for (const h of hurts) {
    if (rectsOverlap(atk, h)) return true;
  }
  return false;
}

/** Signed horizontal distance between the closest edges of two hurtbox
 *  clouds. Negative = overlapping. Used to decide if a candidate attack
 *  (with a known reach vs target hurtbox) will connect. */
export function horizontalGap(
  a: { hurtboxes?: HitboxRect[]; pushbox?: HitboxRect | null },
  b: { hurtboxes?: HitboxRect[]; pushbox?: HitboxRect | null },
): number {
  // Use pushbox if available (always present) for the body reference.
  const aRef = a.pushbox ?? a.hurtboxes?.[0];
  const bRef = b.pushbox ?? b.hurtboxes?.[0];
  if (!aRef || !bRef) return Number.POSITIVE_INFINITY;
  const aRight = aRef.cx + aRef.halfW;
  const aLeft = aRef.cx - aRef.halfW;
  const bRight = bRef.cx + bRef.halfW;
  const bLeft = bRef.cx - bRef.halfW;
  if (aRight < bLeft) return bLeft - aRight;
  if (bRight < aLeft) return aLeft - bRight;
  return -1; // overlapping
}
