import type { GameState, CharacterId } from '../../types';
import type { ActionId } from '../policy/types';
import { evaluateRules, type TasDecision, type RuleContext } from './rule-engine';

export type { TasDecision } from './rule-engine';

export interface TasContext {
  /** True during Ken's own wakeup window (~20f after hurt → neutral). */
  wakeup: boolean;
  /** True while a P1 projectile threat is in flight. */
  fireballIncoming: boolean;
  /** P1's currently-executing move, resolved via animPtr → ActionId. */
  p1Move: ActionId | null;
  /** Frames remaining until P1 exits recovery. */
  p1RecoveryLeft: number;
  /** Frames until P1's move becomes active. */
  p1StartupLeft: number;
  /** True for 15 frames after P1 transitions from airborne to grounded. */
  p1JustLanded: boolean;
}

/** Thin wrapper — delegates to the JSON-driven rule engine. */
export function decideTas(state: GameState, ctx: TasContext): TasDecision {
  const ruleCtx: RuleContext = {
    wakeup: ctx.wakeup,
    fireball: ctx.fireballIncoming,
    p1Move: ctx.p1Move,
    p1RecoveryLeft: ctx.p1RecoveryLeft,
    p1StartupLeft: ctx.p1StartupLeft,
    p1JustLanded: ctx.p1JustLanded,
  };
  return evaluateRules(state, ruleCtx);
}

/** Per-character micro-overrides. No-op — rules are character-agnostic. */
export function applyCharacterFlavor(
  decision: TasDecision,
  _charId: CharacterId,
): TasDecision {
  return decision;
}
