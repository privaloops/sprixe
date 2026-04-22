import type { GameState } from '../../types';
import type { ActionId } from '../policy/types';
import type { ComboId } from './combos';
import rulesFile from './rules.json';

/**
 * JSON-driven rule engine for Ken TAS. Rules are evaluated top-to-
 * bottom and the first full match wins. Edit rules.json to tune
 * behavior without touching code.
 */

export type TasDecision =
  | { kind: 'action'; action: ActionId; reason: string }
  | { kind: 'combo';  combo: ComboId;   reason: string };

export interface RuleContext {
  wakeup: boolean;
  fireball: boolean;
  /** P1's currently executing move (ActionId) resolved from animPtr, or null. */
  p1Move: ActionId | null;
  /** Frames remaining until P1 exits recovery and can act again (0 if idle). */
  p1RecoveryLeft: number;
  /** Frames until P1's current move reaches its first active frame (0 if active or past). */
  p1StartupLeft: number;
  /** True for 15 frames after P1 transitions from airborne to grounded. */
  p1JustLanded: boolean;
}


type P1StateName =
  | 'neutral' | 'walking' | 'crouching'
  | 'airborne' | 'attacking' | 'special_startup'
  | 'recovery' | 'stunned' | 'hurt' | 'any';

interface RuleCondition {
  p1?: P1StateName;
  dist?: string;
  wakeup?: boolean;
  fireball?: boolean;
  p1_cornered?: boolean;
  p2_cornered?: boolean;
  p2_hp?: string;
  /** Exact ActionId match for P1's current move (e.g. "hadouken_fierce"). */
  p1_move?: string;
  /** Numeric predicate on P1's recovery frames remaining. */
  p1_recovery_left?: string;
  /** Numeric predicate on P1's frames until active. */
  p1_startup_left?: string;
  /** Numeric predicate on P1's raw stun counter value. */
  p1_stun_counter?: string;
  /** True during the 15f window after P1 touched ground from a jump. */
  p1_just_landed?: boolean;
}

interface Rule {
  label: string;
  when: RuleCondition;
  do: string;
}

interface RulesFile {
  rules: Rule[];
  fallback: string;
}

// Corner bounds match oracle.ts constants for consistency.
const P1_CORNER_LEFT = 260;
const P1_CORNER_RIGHT = 720;
const P2_CORNER_LEFT = 150;
const P2_CORNER_RIGHT = 870;

// Derive a high-level P1 state name. Order matters: most specific
// first. Threat priority (stunned/hurt/recovery) before posture.
function classifyP1(p1: GameState['p1']): P1StateName {
  if (p1.stunCounter > 32) return 'stunned';
  if (p1.stateByte === 0x0E) return 'hurt';
  if (p1.isRecovery) return 'recovery';
  if (p1.isAirborne) return 'airborne';
  if (p1.stateByte === 0x0C) return 'special_startup';
  if (p1.stateByte === 0x0A && p1.attacking) return 'attacking';
  if (p1.stateByte === 0x02) return 'walking';
  if (p1.isCrouching) return 'crouching';
  return 'neutral';
}

// Parse a distance spec like "<40", ">200", "40-120", ">=60" into a
// predicate. Returns null on parse error (rule is then considered
// never-match for safety).
function parseDist(spec: string): ((d: number) => boolean) | null {
  const s = spec.trim();
  let m = s.match(/^(<=|>=|<|>)\s*(\d+)$/);
  if (m) {
    const [, op, n] = m;
    const v = Number(n);
    if (op === '<')  return (d) => d < v;
    if (op === '<=') return (d) => d <= v;
    if (op === '>')  return (d) => d > v;
    if (op === '>=') return (d) => d >= v;
  }
  m = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (m) {
    const [, lo, hi] = m;
    const a = Number(lo), b = Number(hi);
    return (d) => d >= a && d <= b;
  }
  return null;
}

// Parse a percentage spec for HP (same grammar as dist).
const parseHp = parseDist;

// Combo ID allow-list — must mirror the ComboId union in combos.ts.
// Used to discriminate a rule's `do` between action vs combo.
const COMBO_IDS: ReadonlySet<string> = new Set<ComboId>([
  'ground_chp_dp', 'ground_chp_jab_dp', 'ground_cmk_fb', 'ground_cmk_dp', 'ground_shp_dp',
  'bnb_jhk_chp_dp', 'bnb_jhp_chp_dp', 'bnb_jhk_shp_dp', 'bnb_jhk_cmk_fb', 'bnb_jhp_chp_fb',
  'corner_chp_tatsu', 'bnb_jhk_chp_tatsu',
  'tick_clk_clk_dp', 'tick_clk_clk_throw',
  'stun_jhk_chp_dp', 'aa_fierce_dp',
]);

function toDecision(id: string, label: string): TasDecision {
  if (COMBO_IDS.has(id)) {
    return { kind: 'combo', combo: id as ComboId, reason: label };
  }
  return { kind: 'action', action: id as ActionId, reason: label };
}

export function evaluateRules(state: GameState, ctx: RuleContext): TasDecision {
  const file = rulesFile as unknown as RulesFile;
  const p1 = state.p1;
  const p2 = state.p2;
  const dist = Math.abs(p1.x - p2.x);
  const p1Cornered = p1.x < P1_CORNER_LEFT || p1.x > P1_CORNER_RIGHT;
  const p2Cornered = p2.x < P2_CORNER_LEFT || p2.x > P2_CORNER_RIGHT;
  const p1State = classifyP1(p1);
  const maxHp = p2.maxHp || 144;
  const p2HpPercent = Math.round((p2.hp / maxHp) * 100);

  for (const rule of file.rules) {
    const w = rule.when;
    if (w.p1 !== undefined && w.p1 !== 'any' && w.p1 !== p1State) continue;
    if (w.dist !== undefined) {
      const pred = parseDist(w.dist);
      if (!pred || !pred(dist)) continue;
    }
    if (w.wakeup !== undefined && w.wakeup !== ctx.wakeup) continue;
    if (w.fireball !== undefined && w.fireball !== ctx.fireball) continue;
    if (w.p1_cornered !== undefined && w.p1_cornered !== p1Cornered) continue;
    if (w.p2_cornered !== undefined && w.p2_cornered !== p2Cornered) continue;
    if (w.p2_hp !== undefined) {
      const pred = parseHp(w.p2_hp);
      if (!pred || !pred(p2HpPercent)) continue;
    }
    if (w.p1_move !== undefined && w.p1_move !== ctx.p1Move) continue;
    if (w.p1_recovery_left !== undefined) {
      const pred = parseDist(w.p1_recovery_left);
      if (!pred || !pred(ctx.p1RecoveryLeft)) continue;
    }
    if (w.p1_startup_left !== undefined) {
      const pred = parseDist(w.p1_startup_left);
      if (!pred || !pred(ctx.p1StartupLeft)) continue;
    }
    if (w.p1_stun_counter !== undefined) {
      const pred = parseDist(w.p1_stun_counter);
      if (!pred || !pred(p1.stunCounter)) continue;
    }
    if (w.p1_just_landed !== undefined && w.p1_just_landed !== ctx.p1JustLanded) continue;
    return toDecision(rule.do, rule.label);
  }
  return toDecision(file.fallback, 'fallback');
}
