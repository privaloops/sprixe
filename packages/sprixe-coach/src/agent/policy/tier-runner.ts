import type { GameState } from '../../types';
import type { ActionId, ComboScript, Policy, Rule, RuleAction, Tier } from './types';
import type { InputFrame } from '../input-sequencer';
import type { CharacterMoveset } from '../characters/types';
import type { ConditionContext } from './conditions';
import { evaluateCondition } from './conditions';
import { resolveAction } from './resolvers';
import { buildComboMotion, validateAllCombos } from './combo-builder';
import { LEVELS, type DifficultyLevel, type TierWeights } from './difficulty';

/**
 * TierRunner — decides which action to execute next based on:
 *   1. Combo tier dice (context-aware boost: stun → near-100% combo)
 *   2. Optimal / passive / losing dice for regular rules
 *
 * Combos are built once into a single continuous InputFrame[] motion
 * and returned as a "combo decision" — the PolicyRunner pushes the
 * whole thing to the sequencer atomically. No step-by-step state.
 */
export interface DecisionResult {
  /** Single action to execute via resolveMotion. */
  action?: ActionId;
  /** Pre-built combo motion frames (already resolved + stitched). */
  comboFrames?: InputFrame[];
  tier: Tier;
  comboName?: string;
  ruleLogKey: string;
}

export class TierRunner {
  private readonly baseTierWeights: TierWeights;
  private moveset: CharacterMoveset;
  private readonly level: DifficultyLevel;
  private lastComboName: string | null = null;

  constructor(moveset: CharacterMoveset, level: DifficultyLevel = 'tas') {
    this.moveset = moveset;
    this.level = level;
    // DEBUG MODE: skip personality modulator. We want a pure TAS first
    // (unbeatable Ken), then re-enable personality + contextual tuning
    // once the baseline optimal tier is proven correct.
    this.baseTierWeights = LEVELS[level];
  }

  get levelName(): DifficultyLevel { return this.level; }

  setMoveset(ms: CharacterMoveset): void {
    this.moveset = ms;
  }

  decide(state: GameState, ctx: ConditionContext, policy: Policy): DecisionResult | null {
    // DEBUG MODE: no contextual bump (no forced combo on stun, no
    // losing-drop on HP lead). Enable later once TAS baseline is tuned.
    const weights = this.baseTierWeights;

    // 1. Combo trigger? Dice on combo weight only if some combo matches.
    const combos = policy.combos ?? [];
    const eligibleCombos = combos.filter((c) =>
      c.if.every((cond) => evaluateCondition(cond, state, ctx)),
    );
    if (eligibleCombos.length > 0 && Math.random() < weights.combo) {
      const picked = weightedPickCombo(eligibleCombos, this.lastComboName);
      if (picked) {
        const built = buildComboMotion(picked, this.moveset, state);
        if (built) {
          this.lastComboName = picked.name;
          return {
            comboFrames: built.frames,
            tier: 'combo',
            comboName: picked.name,
            ruleLogKey: `combo:${picked.name}`,
          };
        }
      }
    }

    // 2. Roll tier among optimal/passive/losing. Renormalize.
    const nonComboTotal = weights.optimal + weights.passive + weights.losing;
    if (nonComboTotal <= 0) return null;
    const r = Math.random() * nonComboTotal;
    let tier: Tier;
    if (r < weights.optimal) tier = 'optimal';
    else if (r < weights.optimal + weights.passive) tier = 'passive';
    else tier = 'losing';

    const picked = this.matchAndPick(state, ctx, policy, tier)
                 ?? (tier !== 'optimal' ? this.matchAndPick(state, ctx, policy, 'optimal') : null);
    if (!picked) return null;

    return {
      action: resolveAction(picked.rule.do, this.moveset, state),
      tier: picked.effectiveTier,
      ruleLogKey: `${picked.effectiveTier}:${picked.rule.if.join('+')}→${ruleActionKey(picked.rule.do)}`,
    };
  }

  reset(): void {
    this.lastComboName = null;
  }

  private matchAndPick(
    state: GameState,
    ctx: ConditionContext,
    policy: Policy,
    tier: Tier,
  ): { rule: Rule; effectiveTier: Tier } | null {
    const matched: Rule[] = [];
    for (const rule of policy.rules) {
      if (rule.tier !== tier) continue;
      if (rule.if.every((cond) => evaluateCondition(cond, state, ctx))) {
        matched.push(rule);
      }
    }
    if (matched.length === 0) return null;
    const priorityTop = Math.max(...matched.map((r) => rulePriority(r.if)));
    const topRules = matched.filter((r) => rulePriority(r.if) === priorityTop);
    const chosen = weightedPick(topRules);
    if (!chosen) return null;
    return { rule: chosen, effectiveTier: tier };
  }
}

function ruleActionKey(a: RuleAction): string {
  return typeof a === 'string' ? a : String(a);
}

function weightedPick<T extends { weight: number }>(items: readonly T[]): T | null {
  if (items.length === 0) return null;
  const total = items.reduce((s, r) => s + r.weight, 0);
  if (total <= 0) return items[0] ?? null;
  let t = Math.random() * total;
  for (const it of items) {
    t -= it.weight;
    if (t <= 0) return it;
  }
  return items[items.length - 1] ?? null;
}

function weightedPickCombo(
  combos: readonly ComboScript[],
  avoid: string | null,
): ComboScript | null {
  // TAS-perfect combo selection: pick the maximum-damage combo among
  // eligible ones. weight is the damage-to-HP ratio (0.55 = 55% of
  // the HP bar). Repeats of the same combo are avoided when possible
  // to preserve visual variety, but if only one matches we fire it.
  if (combos.length === 0) return null;
  const filtered = avoid ? combos.filter((c) => c.name !== avoid) : combos;
  const pool = filtered.length > 0 ? filtered : combos;
  let best: ComboScript | null = null;
  for (const c of pool) {
    if (!best || c.weight > best.weight) best = c;
  }
  return best;
}

function rulePriority(conds: readonly string[]): number {
  // Threat geometry outranks every abstract condition — when an
  // attackbox is physically about to hit P2, geometry is the only
  // thing that matters.
  if (conds.includes('threat_imminent') && conds.includes('threat_low'))      return 120;
  if (conds.includes('threat_imminent') && conds.includes('threat_overhead')) return 115;
  if (conds.includes('threat_imminent')) return 110;
  if (conds.includes('p1_whiffing_punishable')) return 95;
  if (conds.includes('p1_grab_range')) return 92;
  if (conds.includes('p1_jump_forward') && (conds.includes('dist_close') || conds.includes('dist_mid'))) return 100;
  if (conds.includes('me_stunned')) return 90;
  if (conds.includes('p1_stunned')) return 85;
  if (conds.includes('p1_whiffed_special')) return 80;
  if (conds.includes('p1_recovery_normal')) return 75;
  if (conds.includes('fireball_flying')) return 70;
  if (conds.includes('p1_attacking_special')) return 65;
  if (conds.includes('p1_attacking_normal')) return 55;
  if (conds.includes('cornered_me')) return 60;
  if (conds.includes('cornered_them')) return 50;
  return 10;
}

// Re-export for one-shot validation at policy load time.
export { validateAllCombos };
