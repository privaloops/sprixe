/**
 * Character abstraction used by the tiered policy system.
 * A Role is a functional intent (e.g. "anti-air") that the tier-runner
 * resolves to a concrete ActionId via the current character's moveset.
 * This lets the same high-level policy (optimal/passive/losing/combo)
 * drive every playable character — only the moveset changes.
 */
import type { ActionId } from '../policy/types';
import type { CharacterId } from '../../types';

export type RoleId =
  // Projectiles
  | 'fireball_fast'        // jab/low-recovery — for zoning
  | 'fireball_strong'      // fierce/heavy — chip damage, punish whiff
  // Anti-air
  | 'anti_air'             // best DP / anti-air choice (shoryu fierce / flash kick)
  | 'anti_air_safe'        // safer reversal (jab DP)
  | 'anti_air_normal'      // c.HP / s.HP when no DP available
  // Approach
  | 'approach'             // closes distance (tatsu / jump-in / dash)
  | 'air_approach'         // tatsu aérien, sumo splash, j.MP safe jump
  | 'jump_in_safe'         // j.MK / j.MP — baits reversal
  | 'jump_in_reward'       // j.HK / j.HP — max damage jump-in
  // Neutral / footsies
  | 'footsie_poke'         // c.MK / s.MK — main neutral tool
  | 'long_poke'            // s.HK range
  | 'sweep'                // c.HK knockdown
  | 'big_punish'           // strongest combo starter (DP / super)
  // Defense
  | 'block'                // crouch block (low-priority defensive)
  | 'block_high'           // standing block vs overheads
  | 'walk_back'            // reset space
  | 'walk_forward'         // advance
  | 'jump_back_escape'     // bail with j.HK preemptive
  | 'reset_space'          // back dash / neutral jump
  // Throws
  | 'throw_tech'           // throw to break blockstring
  | 'throw_back'           // command throw opposite direction
  // Wasted / losing
  | 'whiff_special'        // burn a special in neutral
  | 'walk_into_projectile' // walk into fireball
  | 'unsafe_jump';         // jump in bad range

/**
 * Explicit mapping from Role to 1+ concrete ActionIds. Multiple entries
 * let the resolver pick one (often randomly, sometimes context-aware).
 * A character that lacks a role (e.g. Dhalsim has no DP) leaves it
 * unset — the resolver falls back to the role's default list.
 */
export type RoleMap = Partial<Record<RoleId, readonly ActionId[]>>;

/**
 * Personality biases the tier dice and role resolution.
 *   aggression   : shifts passive → optimal/combo
 *   patience     : shifts optimal → passive (turtle more)
 *   execution    : chance of hitting a combo's full script vs dropping
 *   risk_tolerance: picks unsafe variants of a role (shoryu_fierce over jab)
 * All values in [0, 1] with 0.5 = neutral.
 */
export interface Personality {
  aggression: number;
  patience: number;
  execution: number;
  riskTolerance: number;
}

export interface CharacterMoveset {
  id: CharacterId;
  displayName: string;
  archetype: 'shoto' | 'grappler' | 'charge' | 'zoner' | 'rushdown' | 'stretchy';
  personality: Personality;
  /** Primary role → action bindings. Roles not listed use defaults. */
  roles: RoleMap;
}

export const NEUTRAL_PERSONALITY: Personality = {
  aggression: 0.5,
  patience: 0.5,
  execution: 0.75,
  riskTolerance: 0.5,
};
