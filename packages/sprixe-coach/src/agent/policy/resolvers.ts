import type { GameState } from '../../types';
import type { ActionId, RuleAction, RoleReference } from './types';
import type { CharacterMoveset, RoleId } from '../characters/types';

/**
 * Role → ActionId resolver. Given a RuleAction that may be a concrete
 * ActionId or a role reference ("role:anti_air"), return the concrete
 * ActionId to execute given the current character's moveset and state.
 *
 * The resolver knows which role variants to prefer in which context:
 *   - near_death → safer variants (jab DP over fierce)
 *   - hp lead → aggressive variants
 *   - cornered_me → escape-biased role choices
 * Beyond that it picks uniformly from the role's list.
 */
export function resolveAction(
  action: RuleAction,
  moveset: CharacterMoveset,
  state: GameState,
): ActionId {
  if (!isRoleReference(action)) {
    return action;
  }
  const role = extractRole(action);
  const candidates = moveset.roles[role] ?? defaultForRole(role);
  if (candidates.length === 0) {
    // Absolute last-ditch fallback — should never happen with a complete moveset.
    return 'walk_back';
  }
  return pickByContext(role, candidates, moveset, state);
}

function isRoleReference(a: RuleAction): a is RoleReference {
  return typeof a === 'string' && a.startsWith('role:');
}

function extractRole(ref: RoleReference): RoleId {
  return ref.slice('role:'.length) as RoleId;
}

/** Pick a variant based on context (HP, risk tolerance, position). */
function pickByContext(
  role: RoleId,
  candidates: readonly ActionId[],
  moveset: CharacterMoveset,
  state: GameState,
): ActionId {
  const { riskTolerance } = moveset.personality;
  const nearDeath = state.p2.hp < state.p2.maxHp * 0.2;
  const hpLead = (state.p2.hp - state.p1.hp) > 40;

  // Safer picks when survival matters — downgrade anti_air to anti_air_safe.
  if (nearDeath && role === 'anti_air' && moveset.roles.anti_air_safe) {
    return pickOne(moveset.roles.anti_air_safe);
  }

  // Anti-air specifically: when we have HP lead, prefer the heaviest
  // variant (first entry — Ryu/Ken moveset orders anti_air as
  // [shoryu_fierce, shoryu_strong]). This fixes the prior behavior
  // where Ken defaulted to shoryu_jab even while winning.
  if (role === 'anti_air' && (hpLead || state.p2.hp > state.p1.hp)) {
    return candidates[0] ?? pickOne(candidates);
  }

  // Risk-tolerant personas prefer the later entries (stronger usually
  // means bigger commit — shoryu_fierce vs shoryu_jab).
  if (hpLead || riskTolerance > 0.6) {
    const biased = Math.min(
      candidates.length - 1,
      Math.floor(Math.random() * candidates.length * 0.7 + candidates.length * 0.3),
    );
    return candidates[biased] ?? candidates[0]!;
  }

  return pickOne(candidates);
}

function pickOne<T>(list: readonly T[]): T {
  const idx = Math.floor(Math.random() * list.length);
  return list[idx]!;
}

/**
 * Defaults used when a character's moveset doesn't specify a role.
 * Chosen to be as neutral as possible — most characters have
 * something here even without an explicit mapping.
 */
function defaultForRole(role: RoleId): readonly ActionId[] {
  switch (role) {
    case 'fireball_fast':    return ['hadouken_jab'];
    case 'fireball_strong':  return ['hadouken_fierce'];
    case 'anti_air':         return ['shoryu_fierce'];
    case 'anti_air_safe':    return ['shoryu_jab'];
    case 'anti_air_normal':  return ['crouch_fierce'];
    case 'approach':         return ['walk_forward'];
    case 'air_approach':     return ['jump_forward_mk'];
    case 'jump_in_safe':     return ['jump_forward_mk'];
    case 'jump_in_reward':   return ['jump_forward_hk'];
    case 'footsie_poke':     return ['crouch_mk'];
    case 'long_poke':        return ['standing_rh'];
    case 'sweep':            return ['sweep'];
    case 'big_punish':       return ['shoryu_fierce'];
    case 'block':            return ['block_crouch'];
    case 'block_high':       return ['block_stand'];
    case 'walk_back':        return ['walk_back'];
    case 'walk_forward':     return ['walk_forward'];
    case 'jump_back_escape': return ['jump_back_hk'];
    case 'reset_space':      return ['walk_back'];
    case 'throw_tech':       return ['throw_forward'];
    case 'throw_back':       return ['throw_back'];
    case 'whiff_special':    return ['whiff_shoryu_midscreen'];
    case 'walk_into_projectile': return ['walk_into_fireball'];
    case 'unsafe_jump':      return ['empty_jump'];
  }
}

/** Convenience builder — write `role('anti_air')` in policies. */
export function role(id: RoleId): RoleReference {
  return `role:${id}` as RoleReference;
}
