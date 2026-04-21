import type { ActionId } from './policy/types';

/**
 * Frame data for SF2 Hyper Fighting moves. Values taken from the
 * community-consensus SRK wiki / Shoryuken.com frame lists for
 * Ryu/Ken (shoto mirror in HF). Precision: ±1 frame.
 *
 * All durations are at 60 Hz (1 frame = 16.67 ms).
 *
 * `advantage` = frame advantage on hit from the *first active frame*.
 * For cancellable normals, the `cancellableUntil` marks the last frame
 * of the active window during which the motion input for a special
 * must be buffered for the cancel to come out.
 */
export interface FrameData {
  /** Frames before the hit becomes active. */
  startup: number;
  /** Active frames (how long the hitbox is out). */
  active: number;
  /** Recovery after active window until neutral. */
  recovery: number;
  /** Hitstun inflicted on the target — window to link next move. */
  hitstun: number;
  /** Blockstun inflicted on a blocking target. */
  blockstun: number;
  /** Frame advantage from first active frame (useful for links). */
  advantage: number;
  /** Last active frame during which a special can be cancelled from it. */
  cancellableUntil?: number;
  /** Does this move knockdown the target? */
  knockdown?: boolean;
}

/** Frame data for Ryu. Ken mirrors these values in HF. */
export const FRAME_DATA: Partial<Record<ActionId, FrameData>> = {
  // ── Light normals (fast, chainable) ────────────────────────────
  standing_jab:     { startup: 3,  active: 4,  recovery: 6,  hitstun: 10, blockstun: 7,  advantage: 5,  cancellableUntil: 4 },
  standing_short:   { startup: 3,  active: 4,  recovery: 7,  hitstun: 10, blockstun: 7,  advantage: 4 },
  crouch_jab:       { startup: 3,  active: 4,  recovery: 5,  hitstun: 10, blockstun: 7,  advantage: 6,  cancellableUntil: 4 },
  crouch_short:     { startup: 3,  active: 4,  recovery: 7,  hitstun: 10, blockstun: 7,  advantage: 4 },

  // ── Medium normals (linkable, cancellable) ─────────────────────
  standing_strong:  { startup: 5,  active: 5,  recovery: 12, hitstun: 14, blockstun: 11, advantage: 2,  cancellableUntil: 8 },
  standing_forward: { startup: 7,  active: 6,  recovery: 13, hitstun: 14, blockstun: 11, advantage: 0,  cancellableUntil: 10 },
  crouch_strong:    { startup: 5,  active: 4,  recovery: 11, hitstun: 14, blockstun: 11, advantage: 4,  cancellableUntil: 7 },
  crouch_mk:        { startup: 7,  active: 6,  recovery: 12, hitstun: 14, blockstun: 11, advantage: 3,  cancellableUntil: 10 },

  // ── Heavy normals (damage, some cancellable) ───────────────────
  standing_fierce:  { startup: 6,  active: 6,  recovery: 18, hitstun: 18, blockstun: 14, advantage: -1, cancellableUntil: 10 },
  standing_rh:      { startup: 10, active: 6,  recovery: 22, hitstun: 18, blockstun: 14, advantage: -4 },
  crouch_fierce:    { startup: 5,  active: 8,  recovery: 17, hitstun: 18, blockstun: 14, advantage: 0,  cancellableUntil: 10 },
  sweep:            { startup: 8,  active: 6,  recovery: 24, hitstun: 18, blockstun: 14, advantage: -6, knockdown: true },

  // ── Specials ───────────────────────────────────────────────────
  // Hadoukens: startup + projectile travel. Recovery is the animation
  // after the fireball comes out — Ryu is still stuck.
  hadouken_jab:     { startup: 13, active: 1,  recovery: 30, hitstun: 14, blockstun: 12, advantage: -4 },
  hadouken_strong:  { startup: 11, active: 1,  recovery: 30, hitstun: 14, blockstun: 12, advantage: -3 },
  hadouken_fierce:  { startup: 10, active: 1,  recovery: 30, hitstun: 14, blockstun: 12, advantage: -2 },

  // Shoryukens: invincible startup, big recovery on whiff, knockdown on hit.
  shoryu_jab:       { startup: 3,  active: 10, recovery: 24, hitstun: 20, blockstun: 12, advantage: -12, knockdown: true },
  shoryu_strong:    { startup: 4,  active: 12, recovery: 30, hitstun: 22, blockstun: 14, advantage: -15, knockdown: true },
  shoryu_fierce:    { startup: 5,  active: 14, recovery: 34, hitstun: 24, blockstun: 16, advantage: -18, knockdown: true },

  // Tatsus: multi-hit approach, knockdown on final hit.
  tatsu_lk:         { startup: 6,  active: 14, recovery: 20, hitstun: 16, blockstun: 12, advantage: -4, knockdown: true },
  tatsu_mk:         { startup: 6,  active: 18, recovery: 22, hitstun: 16, blockstun: 12, advantage: -4, knockdown: true },
  tatsu_hk:         { startup: 6,  active: 22, recovery: 24, hitstun: 16, blockstun: 12, advantage: -4, knockdown: true },

  // ── Jump-ins (heavy air normals) ───────────────────────────────
  // Hitstun on ground hit counted as if landing with 0 frame gap —
  // real value depends on timing, so combo chains post jump-in rely
  // on landing advantage which we approximate at +8 frames.
  jump_forward_hp:  { startup: 6,  active: 8,  recovery: 0,  hitstun: 18, blockstun: 14, advantage: 8 },
  jump_forward_hk:  { startup: 8,  active: 12, recovery: 0,  hitstun: 18, blockstun: 14, advantage: 8 },
  jump_forward_mk:  { startup: 5,  active: 10, recovery: 0,  hitstun: 14, blockstun: 11, advantage: 6 },
  jump_forward_mp:  { startup: 4,  active: 8,  recovery: 0,  hitstun: 14, blockstun: 11, advantage: 6 },

  // ── Throws ────────────────────────────────────────────────────
  throw_forward:    { startup: 3,  active: 1,  recovery: 20, hitstun: 0,  blockstun: 0,  advantage: 0,  knockdown: true },
  throw_back:       { startup: 3,  active: 1,  recovery: 20, hitstun: 0,  blockstun: 0,  advantage: 0,  knockdown: true },
};

export function getFrameData(action: ActionId): FrameData | null {
  return FRAME_DATA[action] ?? null;
}

/**
 * Returns the latest frame at which an action B can be started so that
 * its first active frame lands within action A's hitstun window.
 * Negative = B must be started before A's recovery ends (= cancel).
 * Used by combo validator to verify links connect.
 */
export function computeLinkWindow(
  actionA: ActionId,
  actionB: ActionId,
): { feasible: boolean; latestStartFrameFromAHit: number } {
  const a = getFrameData(actionA);
  const b = getFrameData(actionB);
  if (!a || !b) return { feasible: false, latestStartFrameFromAHit: 0 };
  // From the frame A hits, we have `a.hitstun` frames of freeze on the
  // target. B's first active frame must land inside that window:
  //   latestStart = hitstun - b.startup
  const latest = a.hitstun - b.startup;
  return { feasible: latest >= 0, latestStartFrameFromAHit: latest };
}
