import type { CharacterId } from '../../types';
import type { CharacterMoveset } from './types';
import { RYU_MOVESET } from './ryu';
import { KEN_MOVESET } from './ken';

export { RYU_MOVESET, KEN_MOVESET };
export type { CharacterMoveset, RoleId, Personality, RoleMap } from './types';
export { NEUTRAL_PERSONALITY } from './types';

const REGISTRY: Partial<Record<CharacterId, CharacterMoveset>> = {
  ryu: RYU_MOVESET,
  ken: KEN_MOVESET,
};

export function getMoveset(charId: CharacterId): CharacterMoveset {
  // Fallback to Ryu until every cast member has a dedicated file.
  return REGISTRY[charId] ?? RYU_MOVESET;
}
