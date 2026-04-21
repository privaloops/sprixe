import type { Policy } from './types';
import { OPTIMAL_RULES } from './tiers/optimal';
import { PASSIVE_RULES } from './tiers/passive';
import { LOSING_RULES } from './tiers/losing';
import { COMBO_SCRIPTS } from './tiers/combo';
import { role } from './resolvers';
import { validateAllCombos } from './combo-builder';

// Validate every BnB at module load — warns on infeasible links so
// we don't ship combos that won't connect in-game.
validateAllCombos(COMBO_SCRIPTS);

/**
 * Default policy assembled from tiered rule sets. Each rule is tagged
 * with its tier; the tier-runner picks which tier to draw from based
 * on the active difficulty level + character personality.
 *
 * All rules are role-based — the character moveset (Ryu/Ken/etc)
 * resolves roles to concrete ActionIds at execution time, which is
 * why this policy works for the whole shoto cast without edits.
 */
export const DEFAULT_RYU_POLICY: Policy = {
  plan_tag: 'tiered-default',
  rules: [
    ...OPTIMAL_RULES,
    ...PASSIVE_RULES,
    ...LOSING_RULES,
  ],
  combos: COMBO_SCRIPTS,
  fallback: { do: role('walk_forward') },
};
