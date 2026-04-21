import type { Rule } from '../types';
import { role } from '../resolvers';

/**
 * OPTIMAL tier — TAS 100% aggression baseline.
 *
 * Design philosophy: Ken never gives up space. He counter-attacks
 * every opening, pressures every neutral moment, chases every retreat.
 * Block is a last resort only when stuck in blockstun; walk_back is
 * forbidden at the optimal tier (it reappears in the passive tier
 * later for flavour).
 *
 * Translation per situation:
 *   - P1 attacks → throw tech, sweep counter-hit, or DP reversal
 *   - P1 idle/crouching → close the gap, jump in, apply pressure
 *   - Fireball at range → jump over and land jump-in reward
 *   - Cornered me → DP reversal first, throw tech second
 */
export const OPTIMAL_RULES: readonly Rule[] = [
  // ══ ANTI-AIR — mandatory, always fierce ══════════════════════════════
  { tier: 'optimal', if: ['p1_jump_forward', 'dist_close'], do: role('anti_air'),        weight: 0.85, outcome: 'win' },
  { tier: 'optimal', if: ['p1_jump_forward', 'dist_close'], do: role('anti_air_safe'),   weight: 0.15, outcome: 'win' },
  { tier: 'optimal', if: ['p1_jump_forward', 'dist_mid'],   do: role('anti_air'),        weight: 0.55, outcome: 'win' },
  { tier: 'optimal', if: ['p1_jump_forward', 'dist_mid'],   do: role('anti_air_normal'), weight: 0.30, outcome: 'win' },
  { tier: 'optimal', if: ['p1_jump_forward', 'dist_mid'],   do: role('walk_forward'),    weight: 0.15, outcome: 'win' },

  // ══ STUN — full damage punish ═══════════════════════════════════════
  { tier: 'optimal', if: ['p1_stunned'],                    do: role('jump_in_reward'),  weight: 0.40, outcome: 'win' },
  { tier: 'optimal', if: ['p1_stunned'],                    do: role('big_punish'),      weight: 0.35, outcome: 'win' },
  { tier: 'optimal', if: ['p1_stunned'],                    do: role('fireball_strong'), weight: 0.15, outcome: 'win' },
  { tier: 'optimal', if: ['p1_stunned'],                    do: role('sweep'),           weight: 0.10, outcome: 'win' },

  // ══ WHIFF PUNISH — maximum damage on openings ═══════════════════════
  { tier: 'optimal', if: ['p1_whiffed_special'],            do: role('big_punish'),      weight: 0.55, outcome: 'win' },
  { tier: 'optimal', if: ['p1_whiffed_special'],            do: role('sweep'),           weight: 0.30, outcome: 'win' },
  { tier: 'optimal', if: ['p1_whiffed_special'],            do: role('jump_in_reward'),  weight: 0.15, outcome: 'win' },

  { tier: 'optimal', if: ['p1_recovery_normal'],            do: role('big_punish'),      weight: 0.40, outcome: 'win' },
  { tier: 'optimal', if: ['p1_recovery_normal'],            do: role('throw_tech'),      weight: 0.25, outcome: 'win' },
  { tier: 'optimal', if: ['p1_recovery_normal'],            do: role('sweep'),           weight: 0.20, outcome: 'win' },
  { tier: 'optimal', if: ['p1_recovery_normal'],            do: role('long_poke'),       weight: 0.15, outcome: 'win' },

  // ══ FIREBALL INCOMING — ALWAYS go over / through ═══════════════════
  { tier: 'optimal', if: ['fireball_flying', 'dist_far'],   do: role('jump_in_reward'),  weight: 0.70, outcome: 'win' },
  { tier: 'optimal', if: ['fireball_flying', 'dist_far'],   do: role('air_approach'),    weight: 0.30, outcome: 'win' },

  { tier: 'optimal', if: ['fireball_flying', 'dist_mid'],   do: role('jump_in_reward'),  weight: 0.50, outcome: 'win' },
  { tier: 'optimal', if: ['fireball_flying', 'dist_mid'],   do: role('anti_air'),        weight: 0.30, outcome: 'win' },
  { tier: 'optimal', if: ['fireball_flying', 'dist_mid'],   do: role('air_approach'),    weight: 0.20, outcome: 'win' },

  { tier: 'optimal', if: ['fireball_flying', 'dist_close'], do: role('anti_air'),        weight: 0.50, outcome: 'win' },
  { tier: 'optimal', if: ['fireball_flying', 'dist_close'], do: role('throw_tech'),      weight: 0.30, outcome: 'win' },
  { tier: 'optimal', if: ['fireball_flying', 'dist_close'], do: role('sweep'),           weight: 0.20, outcome: 'win' },

  // ══ P1 ATTACKING — touch range = tech, close = DP/sweep ════════════
  { tier: 'optimal', if: ['p1_attacking_normal', 'dist_touch'], do: role('throw_tech'),    weight: 0.55, outcome: 'win' },
  { tier: 'optimal', if: ['p1_attacking_normal', 'dist_touch'], do: role('anti_air'),      weight: 0.30, outcome: 'win' },
  { tier: 'optimal', if: ['p1_attacking_normal', 'dist_touch'], do: role('throw_back'),    weight: 0.15, outcome: 'win' },

  { tier: 'optimal', if: ['p1_attacking_normal', 'dist_close'], do: role('throw_tech'),    weight: 0.35, outcome: 'win' },
  { tier: 'optimal', if: ['p1_attacking_normal', 'dist_close'], do: role('anti_air'),      weight: 0.30, outcome: 'win' },
  { tier: 'optimal', if: ['p1_attacking_normal', 'dist_close'], do: role('sweep'),         weight: 0.20, outcome: 'win' },
  { tier: 'optimal', if: ['p1_attacking_normal', 'dist_close'], do: role('throw_back'),    weight: 0.10, outcome: 'win' },
  { tier: 'optimal', if: ['p1_attacking_normal', 'dist_close'], do: role('block'),         weight: 0.05, outcome: 'neutral' },

  { tier: 'optimal', if: ['p1_attacking_normal', 'dist_mid'],   do: role('long_poke'),     weight: 0.30, outcome: 'win' },
  { tier: 'optimal', if: ['p1_attacking_normal', 'dist_mid'],   do: role('footsie_poke'),  weight: 0.25, outcome: 'win' },
  { tier: 'optimal', if: ['p1_attacking_normal', 'dist_mid'],   do: role('sweep'),         weight: 0.20, outcome: 'win' },
  { tier: 'optimal', if: ['p1_attacking_normal', 'dist_mid'],   do: role('approach'),      weight: 0.15, outcome: 'win' },
  { tier: 'optimal', if: ['p1_attacking_normal', 'dist_mid'],   do: role('anti_air'),      weight: 0.10, outcome: 'trade' },

  // ══ P1 IDLE — touch = instant throw, close = pressure ═══════════════
  { tier: 'optimal', if: ['p1_idle', 'dist_touch'],         do: role('throw_tech'),      weight: 0.55, outcome: 'win' },
  { tier: 'optimal', if: ['p1_idle', 'dist_touch'],         do: role('big_punish'),      weight: 0.20, outcome: 'win' },
  { tier: 'optimal', if: ['p1_idle', 'dist_touch'],         do: role('throw_back'),      weight: 0.15, outcome: 'win' },
  { tier: 'optimal', if: ['p1_idle', 'dist_touch'],         do: role('footsie_poke'),    weight: 0.10, outcome: 'win' },

  { tier: 'optimal', if: ['p1_idle', 'dist_close'],         do: role('throw_tech'),      weight: 0.30, outcome: 'win' },
  { tier: 'optimal', if: ['p1_idle', 'dist_close'],         do: role('sweep'),           weight: 0.25, outcome: 'win' },
  { tier: 'optimal', if: ['p1_idle', 'dist_close'],         do: role('footsie_poke'),    weight: 0.20, outcome: 'win' },
  { tier: 'optimal', if: ['p1_idle', 'dist_close'],         do: role('big_punish'),      weight: 0.15, outcome: 'win' },
  { tier: 'optimal', if: ['p1_idle', 'dist_close'],         do: role('long_poke'),       weight: 0.10, outcome: 'win' },

  { tier: 'optimal', if: ['p1_idle', 'dist_mid'],           do: role('approach'),        weight: 0.30, outcome: 'win' },
  { tier: 'optimal', if: ['p1_idle', 'dist_mid'],           do: role('jump_in_reward'),  weight: 0.25, outcome: 'win' },
  { tier: 'optimal', if: ['p1_idle', 'dist_mid'],           do: role('footsie_poke'),    weight: 0.15, outcome: 'win' },
  { tier: 'optimal', if: ['p1_idle', 'dist_mid'],           do: role('long_poke'),       weight: 0.15, outcome: 'win' },
  { tier: 'optimal', if: ['p1_idle', 'dist_mid'],           do: role('walk_forward'),    weight: 0.15, outcome: 'win' },

  { tier: 'optimal', if: ['p1_idle', 'dist_far'],           do: role('fireball_strong'), weight: 0.35, outcome: 'win' },
  { tier: 'optimal', if: ['p1_idle', 'dist_far'],           do: role('walk_forward'),    weight: 0.25, outcome: 'win' },
  { tier: 'optimal', if: ['p1_idle', 'dist_far'],           do: role('jump_in_reward'),  weight: 0.20, outcome: 'win' },
  { tier: 'optimal', if: ['p1_idle', 'dist_far'],           do: role('fireball_fast'),   weight: 0.20, outcome: 'win' },

  { tier: 'optimal', if: ['p1_idle', 'dist_fullscreen'],    do: role('fireball_strong'), weight: 0.50, outcome: 'win' },
  { tier: 'optimal', if: ['p1_idle', 'dist_fullscreen'],    do: role('walk_forward'),    weight: 0.30, outcome: 'win' },
  { tier: 'optimal', if: ['p1_idle', 'dist_fullscreen'],    do: role('fireball_fast'),   weight: 0.20, outcome: 'win' },

  // ══ P1 CROUCHING — touch = throw guaranteed, close = mixup ══════════
  { tier: 'optimal', if: ['p1_crouching', 'dist_touch'],    do: role('throw_tech'),      weight: 0.65, outcome: 'win' },
  { tier: 'optimal', if: ['p1_crouching', 'dist_touch'],    do: role('big_punish'),      weight: 0.20, outcome: 'win' },
  { tier: 'optimal', if: ['p1_crouching', 'dist_touch'],    do: role('throw_back'),      weight: 0.15, outcome: 'win' },

  { tier: 'optimal', if: ['p1_crouching', 'dist_close'],    do: role('throw_tech'),      weight: 0.40, outcome: 'win' },
  { tier: 'optimal', if: ['p1_crouching', 'dist_close'],    do: role('sweep'),           weight: 0.20, outcome: 'win' },
  { tier: 'optimal', if: ['p1_crouching', 'dist_close'],    do: role('big_punish'),      weight: 0.20, outcome: 'win' },
  { tier: 'optimal', if: ['p1_crouching', 'dist_close'],    do: role('long_poke'),       weight: 0.10, outcome: 'win' },
  { tier: 'optimal', if: ['p1_crouching', 'dist_close'],    do: role('throw_back'),      weight: 0.10, outcome: 'win' },

  { tier: 'optimal', if: ['p1_crouching', 'dist_mid'],      do: role('jump_in_reward'),  weight: 0.40, outcome: 'win' },
  { tier: 'optimal', if: ['p1_crouching', 'dist_mid'],      do: role('approach'),        weight: 0.25, outcome: 'win' },
  { tier: 'optimal', if: ['p1_crouching', 'dist_mid'],      do: role('sweep'),           weight: 0.20, outcome: 'win' },
  { tier: 'optimal', if: ['p1_crouching', 'dist_mid'],      do: role('footsie_poke'),    weight: 0.15, outcome: 'win' },

  // ══ P1 WALKING BACK — chase, never let them breathe ══════════════════
  { tier: 'optimal', if: ['p1_walking_back', 'dist_far'],   do: role('fireball_strong'), weight: 0.40, outcome: 'win' },
  { tier: 'optimal', if: ['p1_walking_back', 'dist_far'],   do: role('walk_forward'),    weight: 0.30, outcome: 'win' },
  { tier: 'optimal', if: ['p1_walking_back', 'dist_far'],   do: role('jump_in_reward'),  weight: 0.30, outcome: 'win' },

  { tier: 'optimal', if: ['p1_walking_back', 'dist_mid'],   do: role('walk_forward'),    weight: 0.30, outcome: 'win' },
  { tier: 'optimal', if: ['p1_walking_back', 'dist_mid'],   do: role('long_poke'),       weight: 0.25, outcome: 'win' },
  { tier: 'optimal', if: ['p1_walking_back', 'dist_mid'],   do: role('footsie_poke'),    weight: 0.20, outcome: 'win' },
  { tier: 'optimal', if: ['p1_walking_back', 'dist_mid'],   do: role('jump_in_reward'),  weight: 0.15, outcome: 'win' },
  { tier: 'optimal', if: ['p1_walking_back', 'dist_mid'],   do: role('fireball_fast'),   weight: 0.10, outcome: 'win' },

  // ══ P1 WALKING FORWARD — counter their approach ══════════════════════
  { tier: 'optimal', if: ['p1_walking_forward', 'dist_mid'], do: role('long_poke'),       weight: 0.30, outcome: 'win' },
  { tier: 'optimal', if: ['p1_walking_forward', 'dist_mid'], do: role('fireball_fast'),   weight: 0.25, outcome: 'win' },
  { tier: 'optimal', if: ['p1_walking_forward', 'dist_mid'], do: role('footsie_poke'),    weight: 0.20, outcome: 'win' },
  { tier: 'optimal', if: ['p1_walking_forward', 'dist_mid'], do: role('sweep'),           weight: 0.15, outcome: 'win' },
  { tier: 'optimal', if: ['p1_walking_forward', 'dist_mid'], do: role('anti_air'),        weight: 0.10, outcome: 'trade' },

  // ══ P1 JUMP NEUTRAL — close the distance while they're stuck ════════
  { tier: 'optimal', if: ['p1_jump_neutral', 'dist_mid'],   do: role('walk_forward'),    weight: 0.45, outcome: 'win' },
  { tier: 'optimal', if: ['p1_jump_neutral', 'dist_mid'],   do: role('approach'),        weight: 0.30, outcome: 'win' },
  { tier: 'optimal', if: ['p1_jump_neutral', 'dist_mid'],   do: role('anti_air'),        weight: 0.25, outcome: 'win' },

  // ══ P1 JUMP BACK — chase hard ═══════════════════════════════════════
  { tier: 'optimal', if: ['p1_jump_back'],                  do: role('walk_forward'),    weight: 0.40, outcome: 'win' },
  { tier: 'optimal', if: ['p1_jump_back'],                  do: role('fireball_strong'), weight: 0.30, outcome: 'win' },
  { tier: 'optimal', if: ['p1_jump_back'],                  do: role('jump_in_reward'),  weight: 0.20, outcome: 'win' },
  { tier: 'optimal', if: ['p1_jump_back'],                  do: role('fireball_fast'),   weight: 0.10, outcome: 'win' },

  // ══ CORNER THEM — close the deal, full pressure ═════════════════════
  { tier: 'optimal', if: ['cornered_them', 'dist_close'],   do: role('throw_tech'),      weight: 0.30, outcome: 'win' },
  { tier: 'optimal', if: ['cornered_them', 'dist_close'],   do: role('big_punish'),      weight: 0.25, outcome: 'win' },
  { tier: 'optimal', if: ['cornered_them', 'dist_close'],   do: role('sweep'),           weight: 0.15, outcome: 'win' },
  { tier: 'optimal', if: ['cornered_them', 'dist_close'],   do: role('footsie_poke'),    weight: 0.10, outcome: 'win' },
  { tier: 'optimal', if: ['cornered_them', 'dist_close'],   do: role('long_poke'),       weight: 0.10, outcome: 'win' },
  { tier: 'optimal', if: ['cornered_them', 'dist_close'],   do: role('throw_back'),      weight: 0.10, outcome: 'win' },

  // ══ CORNERED ME — reversal first, never retreat ═════════════════════
  // Explicit "no jump_back" policy — backdash in corner is a death trap.
  { tier: 'optimal', if: ['cornered_me'],                   do: role('anti_air'),        weight: 0.45, outcome: 'win' },
  { tier: 'optimal', if: ['cornered_me'],                   do: role('throw_tech'),      weight: 0.25, outcome: 'win' },
  { tier: 'optimal', if: ['cornered_me'],                   do: role('anti_air_safe'),   weight: 0.20, outcome: 'win' },
  { tier: 'optimal', if: ['cornered_me'],                   do: role('block'),           weight: 0.10, outcome: 'neutral' },
];
