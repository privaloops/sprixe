import type { CharacterMoveset } from './types';
import { RYU_MOVESET } from './ryu';

/**
 * Ken mirrors Ryu's inputs in SF2HF. The playable difference is
 * personality: Ken is historically played hotter (shoryu pressure,
 * knee bash tatsu, rushdown). We flavor him with higher aggression
 * and a bit more risk tolerance.
 */
export const KEN_MOVESET: CharacterMoveset = {
  ...RYU_MOVESET,
  id: 'ken',
  displayName: 'Ken',
  personality: {
    aggression: 0.68,
    patience: 0.40,
    execution: 0.75,
    riskTolerance: 0.62,
  },
  // Ken-specific flavor: knee bash tatsu is a staple approach tool,
  // shoryu fierce is his signature pressure DP.
  roles: {
    ...RYU_MOVESET.roles,
    approach:      ['tatsu_hk', 'tatsu_mk', 'tatsu_lk', 'walk_forward'],
    big_punish:    ['shoryu_fierce', 'shoryu_strong'],
    anti_air:      ['shoryu_fierce'],
  },
};
