import type { ActionId } from '../policy/types';
import { getFrameData } from '../frame-data';
import type { KenRyuMatrix, PairResult } from './move-range-matrix';

/**
 * Counter-picker derived from the Ken×Ryu punish-range matrix.
 *
 * For each Ryu move, pick Ken's best response: the fastest move that
 * can reach at the current centre-to-centre distance, weighted by
 * damage tier and combo-starter bonus.
 *
 * The matrix is computed once at round start (see move-range-matrix.ts)
 * and passed in; this module does not touch the ROM itself.
 */

export interface CounterOption {
  kenMove: ActionId;
  maxHitDist: number;
  startup: number;
  /** Preference score used to sort options. Higher = better. */
  score: number;
  /** True if Ken can cancel this move into a DP for a full punish combo. */
  cancellable: boolean;
  /** Knockdown on hit (resets neutral, prevents counter). */
  knockdown: boolean;
}

export interface CounterTable {
  /** Ryu move name → list of Ken counter options, sorted best-first. */
  byRyuMove: Record<string, CounterOption[]>;
}

const DAMAGE_TIER: Partial<Record<ActionId, number>> = {
  standing_jab: 1, crouch_jab: 1, standing_short: 1, crouch_short: 1,
  standing_strong: 2, crouch_strong: 2, standing_forward: 2, crouch_mk: 2,
  standing_fierce: 3, standing_rh: 3, crouch_fierce: 3, sweep: 3,
  hadouken_jab: 2, hadouken_strong: 2, hadouken_fierce: 3,
  shoryu_jab: 3, shoryu_strong: 4, shoryu_fierce: 5,
  tatsu_lk: 3, tatsu_mk: 3, tatsu_hk: 4,
  jump_forward_hp: 3, jump_forward_hk: 4, jump_forward_mk: 2, jump_forward_mp: 2,
  throw_forward: 3, throw_back: 3,
};

/**
 * Preference score: fast + damaging + cancellable > slow. Negative
 * startup penalty dominates because a slow move that can't reach in
 * time just isn't an option even if it hits hard.
 */
function scoreOption(
  kenMove: ActionId,
  startup: number,
  damageTier: number,
  cancellable: boolean,
  knockdown: boolean,
): number {
  const speedScore = Math.max(0, 12 - startup);  // 12f startup = 0, 3f = 9
  const damageScore = damageTier * 2;
  const cancelBonus = cancellable ? 3 : 0;
  const kdBonus = knockdown ? 2 : 0;
  return speedScore + damageScore + cancelBonus + kdBonus;
}

/**
 * Turn the raw range matrix into a sorted counter table. Options with
 * maxHitDist <= 0 (can't connect) are dropped.
 */
export function buildCounterTable(matrix: KenRyuMatrix): CounterTable {
  const byRyuMove: Record<string, CounterOption[]> = {};
  for (const [kenMove, row] of Object.entries(matrix)) {
    const fd = getFrameData(kenMove as ActionId);
    if (!fd) continue;
    const damageTier = DAMAGE_TIER[kenMove as ActionId] ?? 1;
    const cancellable = fd.cancellableUntil !== undefined;
    const knockdown = fd.knockdown === true;
    const score = scoreOption(kenMove as ActionId, fd.startup, damageTier, cancellable, knockdown);
    for (const [ryuMove, pair] of Object.entries(row) as Array<[string, PairResult]>) {
      if (pair.maxHitDist <= 0) continue;
      if (!byRyuMove[ryuMove]) byRyuMove[ryuMove] = [];
      byRyuMove[ryuMove]!.push({
        kenMove: kenMove as ActionId,
        maxHitDist: pair.maxHitDist,
        startup: fd.startup,
        score,
        cancellable,
        knockdown,
      });
    }
  }
  for (const ryuMove of Object.keys(byRyuMove)) {
    byRyuMove[ryuMove]!.sort((a, b) => b.score - a.score);
  }
  return { byRyuMove };
}

export interface PickOptions {
  /** Current centre-to-centre distance between Ken and Ryu. */
  dist: number;
  /** Ryu move Ken is reacting to. */
  ryuMove: string;
  /** Only pick moves whose startup is ≤ this many frames. Use this to
   *  bound the decision to moves that connect within the victim's
   *  recovery window. */
  maxStartup?: number;
  /** Minimum safety margin (px). A move is considered viable only if
   *  dist ≤ maxHitDist - safetyMargin. Default 8. */
  safetyMargin?: number;
}

/** Best single counter, or null if nothing fits. */
export function pickCounter(
  table: CounterTable,
  opts: PickOptions,
): CounterOption | null {
  const options = table.byRyuMove[opts.ryuMove] ?? [];
  const margin = opts.safetyMargin ?? 8;
  const maxStart = opts.maxStartup ?? Infinity;
  for (const o of options) {
    if (o.startup > maxStart) continue;
    if (opts.dist > o.maxHitDist - margin) continue;
    return o;
  }
  return null;
}

/** Pretty-print the table for debugging / console dumps. */
export function dumpCounterTable(table: CounterTable): string {
  const lines: string[] = ['\n=== KEN COUNTER TABLE (best first) ==='];
  for (const [ryuMove, options] of Object.entries(table.byRyuMove).sort()) {
    lines.push(`\nvs RYU ${ryuMove}:`);
    for (const o of options.slice(0, 6)) {
      const tag = [
        o.cancellable ? 'cancel' : null,
        o.knockdown ? 'KD' : null,
      ].filter(Boolean).join(',') || '·';
      lines.push(
        `  ${o.kenMove.padEnd(18)} range≤${o.maxHitDist.toString().padStart(3)}px`
        + `  startup=${o.startup.toString().padStart(2)}f  score=${o.score.toFixed(1).padStart(4)}  [${tag}]`,
      );
    }
  }
  return lines.join('\n');
}
