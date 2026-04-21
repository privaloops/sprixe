import type { Rule } from '../types';
import { role } from '../resolvers';

/**
 * PASSIVE tier — credible turtle play. No outright mistakes, but
 * preferring low-commitment defensive choices over optimal counters.
 * Drawn often at easy difficulty. Used also as "character is cautious
 * right now" flavor.
 */
export const PASSIVE_RULES: readonly Rule[] = [
  // Anti-air: sometimes just block instead of reversal.
  { tier: 'passive', if: ['p1_jump_forward', 'dist_close'], do: role('block_high'),      weight: 0.55, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_jump_forward', 'dist_close'], do: role('anti_air_safe'),   weight: 0.45, outcome: 'trade' },

  { tier: 'passive', if: ['p1_jump_forward', 'dist_mid'],   do: role('walk_back'),       weight: 0.55, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_jump_forward', 'dist_mid'],   do: role('block'),           weight: 0.45, outcome: 'neutral' },

  // Fireball incoming: block through it instead of risking a punish.
  { tier: 'passive', if: ['fireball_flying', 'dist_far'],   do: role('block'),           weight: 0.65, outcome: 'neutral' },
  { tier: 'passive', if: ['fireball_flying', 'dist_far'],   do: role('walk_back'),       weight: 0.35, outcome: 'neutral' },

  { tier: 'passive', if: ['fireball_flying', 'dist_mid'],   do: role('block'),           weight: 0.70, outcome: 'neutral' },
  { tier: 'passive', if: ['fireball_flying', 'dist_mid'],   do: role('walk_back'),       weight: 0.30, outcome: 'neutral' },

  { tier: 'passive', if: ['fireball_flying', 'dist_close'], do: role('block'),           weight: 0.85, outcome: 'neutral' },
  { tier: 'passive', if: ['fireball_flying', 'dist_close'], do: role('walk_back'),       weight: 0.15, outcome: 'neutral' },

  // Under pressure: lots of block, walk back.
  { tier: 'passive', if: ['p1_attacking_normal', 'dist_close'], do: role('block'),       weight: 0.70, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_attacking_normal', 'dist_close'], do: role('walk_back'),   weight: 0.15, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_attacking_normal', 'dist_close'], do: role('jump_back_escape'), weight: 0.15, outcome: 'neutral' },

  { tier: 'passive', if: ['p1_attacking_normal', 'dist_mid'],   do: role('walk_back'),   weight: 0.50, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_attacking_normal', 'dist_mid'],   do: role('block'),       weight: 0.40, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_attacking_normal', 'dist_mid'],   do: role('reset_space'), weight: 0.10, outcome: 'neutral' },

  // Idle: keep distance, sprinkle a safe fireball.
  { tier: 'passive', if: ['p1_idle', 'dist_close'],         do: role('walk_back'),       weight: 0.45, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_idle', 'dist_close'],         do: role('block'),           weight: 0.30, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_idle', 'dist_close'],         do: role('footsie_poke'),    weight: 0.25, outcome: 'trade' },

  { tier: 'passive', if: ['p1_idle', 'dist_mid'],           do: role('walk_back'),       weight: 0.40, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_idle', 'dist_mid'],           do: role('fireball_fast'),   weight: 0.35, outcome: 'trade' },
  { tier: 'passive', if: ['p1_idle', 'dist_mid'],           do: role('block'),           weight: 0.25, outcome: 'neutral' },

  { tier: 'passive', if: ['p1_idle', 'dist_far'],           do: role('fireball_fast'),   weight: 0.55, outcome: 'trade' },
  { tier: 'passive', if: ['p1_idle', 'dist_far'],           do: role('walk_back'),       weight: 0.25, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_idle', 'dist_far'],           do: role('fireball_strong'), weight: 0.20, outcome: 'trade' },

  // Walking: just mirror or block.
  { tier: 'passive', if: ['p1_walking_forward', 'dist_mid'], do: role('walk_back'),      weight: 0.60, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_walking_forward', 'dist_mid'], do: role('block'),          weight: 0.40, outcome: 'neutral' },

  { tier: 'passive', if: ['p1_walking_back', 'dist_mid'],   do: role('fireball_fast'),   weight: 0.50, outcome: 'trade' },
  { tier: 'passive', if: ['p1_walking_back', 'dist_mid'],   do: role('walk_back'),       weight: 0.50, outcome: 'neutral' },

  // Crouching: don't jump in, just poke from safe range.
  { tier: 'passive', if: ['p1_crouching', 'dist_close'],    do: role('walk_back'),       weight: 0.50, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_crouching', 'dist_close'],    do: role('block'),           weight: 0.30, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_crouching', 'dist_close'],    do: role('footsie_poke'),    weight: 0.20, outcome: 'trade' },

  { tier: 'passive', if: ['p1_crouching', 'dist_mid'],      do: role('fireball_fast'),   weight: 0.45, outcome: 'trade' },
  { tier: 'passive', if: ['p1_crouching', 'dist_mid'],      do: role('walk_back'),       weight: 0.35, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_crouching', 'dist_mid'],      do: role('block'),           weight: 0.20, outcome: 'neutral' },

  // Jumps P1: no chase, reset.
  { tier: 'passive', if: ['p1_jump_back'],                  do: role('walk_back'),       weight: 0.55, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_jump_back'],                  do: role('fireball_fast'),   weight: 0.45, outcome: 'trade' },

  { tier: 'passive', if: ['p1_jump_neutral', 'dist_mid'],   do: role('block'),           weight: 0.55, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_jump_neutral', 'dist_mid'],   do: role('walk_back'),       weight: 0.45, outcome: 'neutral' },

  // Corner pressure: block it out, escape when safe.
  { tier: 'passive', if: ['cornered_me'],                   do: role('block'),           weight: 0.65, outcome: 'neutral' },
  { tier: 'passive', if: ['cornered_me'],                   do: role('jump_back_escape'),weight: 0.35, outcome: 'neutral' },

  // Even when cornering them, passive = don't commit.
  { tier: 'passive', if: ['cornered_them', 'dist_close'],   do: role('block'),           weight: 0.45, outcome: 'neutral' },
  { tier: 'passive', if: ['cornered_them', 'dist_close'],   do: role('footsie_poke'),    weight: 0.35, outcome: 'trade' },
  { tier: 'passive', if: ['cornered_them', 'dist_close'],   do: role('walk_back'),       weight: 0.20, outcome: 'neutral' },

  // Punish opportunity: passive misses the window.
  { tier: 'passive', if: ['p1_whiffed_special'],            do: role('block'),           weight: 0.60, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_whiffed_special'],            do: role('walk_back'),       weight: 0.40, outcome: 'neutral' },

  { tier: 'passive', if: ['p1_recovery_normal'],            do: role('block'),           weight: 0.55, outcome: 'neutral' },
  { tier: 'passive', if: ['p1_recovery_normal'],            do: role('walk_back'),       weight: 0.45, outcome: 'neutral' },

  { tier: 'passive', if: ['p1_stunned'],                    do: role('footsie_poke'),    weight: 0.50, outcome: 'win' },
  { tier: 'passive', if: ['p1_stunned'],                    do: role('long_poke'),       weight: 0.50, outcome: 'win' },
];
