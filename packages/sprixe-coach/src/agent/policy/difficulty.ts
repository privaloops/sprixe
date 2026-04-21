import type { Tier } from './types';
import type { Personality } from '../characters/types';
import type { GameState } from '../../types';

export type DifficultyLevel = 'easy' | 'normal' | 'hard' | 'tas';

/**
 * Tier weights per difficulty level. Sum to 1.0. The tier-runner
 * rolls once per decision to pick a tier, then selects among
 * rules tagged with that tier.
 */
export interface TierWeights {
  combo: number;
  optimal: number;
  passive: number;
  losing: number;
}

export const LEVELS: Record<DifficultyLevel, TierWeights> = {
  easy:   { combo: 0.04, optimal: 0.28, passive: 0.50, losing: 0.18 },
  normal: { combo: 0.20, optimal: 0.55, passive: 0.20, losing: 0.05 },
  hard:   { combo: 0.45, optimal: 0.50, passive: 0.05, losing: 0.00 },
  // TAS — literally perfect. Ken fires the highest-damage combo that
  // matches the current situation every decision it can. Falls to the
  // optimal tier only when no combo is eligible (narrow conditions).
  tas:    { combo: 0.95, optimal: 0.05, passive: 0.00, losing: 0.00 },
};

/**
 * Adjusts tier weights based on the active character's personality.
 * Aggressive characters shift passive → optimal. Patient ones do
 * the opposite. Execution bumps combo rate (they land combos).
 *
 * DEBUG: not currently called — we're baselining a pure TAS first.
 * Re-wire in TierRunner once the optimal tier is proven bulletproof.
 */
export function applyPersonality(
  base: TierWeights,
  personality: Personality,
): TierWeights {
  const aggressionShift = (personality.aggression - 0.5) * 0.2; // ±10%
  const patienceShift = (personality.patience - 0.5) * 0.15;    // ±7.5%
  const executionShift = (personality.execution - 0.5) * 0.1;   // ±5%

  let passive = base.passive - aggressionShift + patienceShift;
  let optimal = base.optimal + aggressionShift - patienceShift;
  let combo = base.combo + executionShift;
  let losing = base.losing;

  // Clamp negatives and renormalize.
  passive = Math.max(0, passive);
  optimal = Math.max(0, optimal);
  combo = Math.max(0, combo);
  losing = Math.max(0, losing);

  const total = combo + optimal + passive + losing;
  return {
    combo: combo / total,
    optimal: optimal / total,
    passive: passive / total,
    losing: losing / total,
  };
}

/** Roll a single tier given the weights. Returns which tier won. */
export function rollTier(weights: TierWeights): Tier {
  let r = Math.random();
  if (r < weights.combo) return 'combo';
  r -= weights.combo;
  if (r < weights.optimal) return 'optimal';
  r -= weights.optimal;
  if (r < weights.passive) return 'passive';
  return 'losing';
}

/**
 * Adjusts tier weights based on live match context. Runs every
 * decision — tiny computation, big behavioral change.
 *
 *   P1 dizzy → force combo (0.55) + optimal (0.45), zero passive/losing.
 *     This is the money moment; don't waste it with a walk_back.
 *   HP lead > 50 → drop losing tier entirely (don't throw a winning match).
 *   HP deficit big → bump combo by 0.08 (desperation play with style).
 *
 * DEBUG: not currently called — same reason as applyPersonality above.
 */
export function contextualizeTierWeights(
  base: TierWeights,
  state: GameState,
): TierWeights {
  if (state.p1.stunCounter > 32 && state.p1.hp > 0) {
    return { combo: 0.55, optimal: 0.45, passive: 0, losing: 0 };
  }
  const diff = state.p2.hp - state.p1.hp;
  if (diff > 50) {
    const extra = base.losing;
    return { ...base, losing: 0, optimal: base.optimal + extra };
  }
  if (diff < -50) {
    const shift = 0.08;
    const from = Math.min(base.passive, shift);
    return {
      combo: base.combo + from,
      optimal: base.optimal,
      passive: base.passive - from,
      losing: base.losing,
    };
  }
  return base;
}

export function parseDifficultyFromUrl(search: string): DifficultyLevel {
  const params = new URLSearchParams(search);
  const raw = params.get('level');
  if (raw === 'easy' || raw === 'hard' || raw === 'tas') return raw;
  return 'normal';
}
