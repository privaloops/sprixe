import type { Rule } from '../types';
import { role } from '../resolvers';

/**
 * LOSING tier — believable human-like mistakes. Never drawn at hard
 * or tas level. At easy level, this tier gives the opponent his
 * signature openings (whiffed DP, walk into fireball, random jump).
 */
export const LOSING_RULES: readonly Rule[] = [
  // Anti-air botched: jumps back into the jump-in instead of DP'ing.
  { tier: 'losing', if: ['p1_jump_forward', 'dist_close'], do: role('unsafe_jump'),     weight: 0.40, outcome: 'loss' },
  { tier: 'losing', if: ['p1_jump_forward', 'dist_close'], do: role('whiff_special'),   weight: 0.40, outcome: 'loss' },
  { tier: 'losing', if: ['p1_jump_forward', 'dist_close'], do: role('walk_forward'),    weight: 0.20, outcome: 'loss' },

  { tier: 'losing', if: ['p1_jump_forward', 'dist_mid'],   do: role('walk_forward'),    weight: 0.60, outcome: 'loss' },
  { tier: 'losing', if: ['p1_jump_forward', 'dist_mid'],   do: role('unsafe_jump'),     weight: 0.40, outcome: 'loss' },

  // Fireball: walk into it, or whiff a shoryu trying to absorb.
  { tier: 'losing', if: ['fireball_flying', 'dist_far'],   do: role('walk_into_projectile'), weight: 0.50, outcome: 'loss' },
  { tier: 'losing', if: ['fireball_flying', 'dist_far'],   do: role('whiff_special'),   weight: 0.50, outcome: 'loss' },

  { tier: 'losing', if: ['fireball_flying', 'dist_mid'],   do: role('walk_into_projectile'), weight: 0.60, outcome: 'loss' },
  { tier: 'losing', if: ['fireball_flying', 'dist_mid'],   do: role('unsafe_jump'),     weight: 0.40, outcome: 'loss' },

  { tier: 'losing', if: ['fireball_flying', 'dist_close'], do: role('whiff_special'),   weight: 0.50, outcome: 'loss' },
  { tier: 'losing', if: ['fireball_flying', 'dist_close'], do: role('unsafe_jump'),     weight: 0.50, outcome: 'loss' },

  // Under attack: random DP or throw whiff.
  { tier: 'losing', if: ['p1_attacking_normal', 'dist_close'], do: role('whiff_special'), weight: 0.55, outcome: 'loss' },
  { tier: 'losing', if: ['p1_attacking_normal', 'dist_close'], do: role('unsafe_jump'),   weight: 0.25, outcome: 'loss' },
  { tier: 'losing', if: ['p1_attacking_normal', 'dist_close'], do: role('walk_forward'),  weight: 0.20, outcome: 'loss' },

  { tier: 'losing', if: ['p1_attacking_normal', 'dist_mid'],   do: role('walk_forward'),  weight: 0.50, outcome: 'loss' },
  { tier: 'losing', if: ['p1_attacking_normal', 'dist_mid'],   do: role('whiff_special'), weight: 0.50, outcome: 'loss' },

  // Idle: random whiffs, leaks openings.
  { tier: 'losing', if: ['p1_idle', 'dist_close'],         do: role('whiff_special'),   weight: 0.50, outcome: 'loss' },
  { tier: 'losing', if: ['p1_idle', 'dist_close'],         do: role('unsafe_jump'),     weight: 0.30, outcome: 'loss' },
  { tier: 'losing', if: ['p1_idle', 'dist_close'],         do: role('walk_forward'),    weight: 0.20, outcome: 'loss' },

  { tier: 'losing', if: ['p1_idle', 'dist_mid'],           do: role('unsafe_jump'),     weight: 0.55, outcome: 'loss' },
  { tier: 'losing', if: ['p1_idle', 'dist_mid'],           do: role('whiff_special'),   weight: 0.45, outcome: 'loss' },

  { tier: 'losing', if: ['p1_idle', 'dist_far'],           do: role('walk_forward'),    weight: 0.50, outcome: 'loss' },
  { tier: 'losing', if: ['p1_idle', 'dist_far'],           do: role('unsafe_jump'),     weight: 0.50, outcome: 'loss' },

  { tier: 'losing', if: ['p1_crouching', 'dist_close'],    do: role('whiff_special'),   weight: 0.60, outcome: 'loss' },
  { tier: 'losing', if: ['p1_crouching', 'dist_close'],    do: role('unsafe_jump'),     weight: 0.40, outcome: 'loss' },

  { tier: 'losing', if: ['p1_crouching', 'dist_mid'],      do: role('unsafe_jump'),     weight: 0.55, outcome: 'loss' },
  { tier: 'losing', if: ['p1_crouching', 'dist_mid'],      do: role('whiff_special'),   weight: 0.45, outcome: 'loss' },

  { tier: 'losing', if: ['p1_walking_forward', 'dist_mid'], do: role('whiff_special'),   weight: 0.55, outcome: 'loss' },
  { tier: 'losing', if: ['p1_walking_forward', 'dist_mid'], do: role('unsafe_jump'),     weight: 0.45, outcome: 'loss' },

  { tier: 'losing', if: ['p1_walking_back', 'dist_mid'],   do: role('unsafe_jump'),     weight: 0.55, outcome: 'loss' },
  { tier: 'losing', if: ['p1_walking_back', 'dist_mid'],   do: role('whiff_special'),   weight: 0.45, outcome: 'loss' },

  { tier: 'losing', if: ['cornered_me'],                   do: role('whiff_special'),   weight: 0.55, outcome: 'loss' },
  { tier: 'losing', if: ['cornered_me'],                   do: role('unsafe_jump'),     weight: 0.45, outcome: 'loss' },

  { tier: 'losing', if: ['cornered_them', 'dist_close'],   do: role('whiff_special'),   weight: 0.50, outcome: 'loss' },
  { tier: 'losing', if: ['cornered_them', 'dist_close'],   do: role('unsafe_jump'),     weight: 0.50, outcome: 'loss' },

  // Punish window: miss the whiff. Classic scrub move.
  { tier: 'losing', if: ['p1_whiffed_special'],            do: role('block'),           weight: 0.50, outcome: 'loss' },
  { tier: 'losing', if: ['p1_whiffed_special'],            do: role('walk_back'),       weight: 0.50, outcome: 'loss' },

  { tier: 'losing', if: ['p1_recovery_normal'],            do: role('block'),           weight: 0.50, outcome: 'loss' },
  { tier: 'losing', if: ['p1_recovery_normal'],            do: role('walk_back'),       weight: 0.50, outcome: 'loss' },

  // Stunned target: let it reset instead of cashing in.
  { tier: 'losing', if: ['p1_stunned'],                    do: role('walk_back'),       weight: 0.60, outcome: 'loss' },
  { tier: 'losing', if: ['p1_stunned'],                    do: role('whiff_special'),   weight: 0.40, outcome: 'loss' },
];
