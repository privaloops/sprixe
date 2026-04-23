import type { ActionId } from '../policy/types';

/**
 * animPtr (startup value) → ActionId for Ken in SF2HF.
 *
 * Populated via the `TasPilot` calibration harness (see
 * `calibration-plan.ts`): the pilot enqueues each Ken motion in turn,
 * observes p2.stateByte leaving 0x00, and logs the first-frame animPtr.
 *
 * Until every entry is filled, `actionForAnimPtr('ken', ...)` returns
 * null for the missing moves — the forward simulator will then treat
 * Ken's state as "unknown" (same as Ryu's unseen moves).
 */
export const KEN_ANIMPTR_TO_ACTION: Record<number, ActionId> = {
  // ── Crouch normals ──
  0x0008F9B2: 'crouch_jab',
  0x0008FA2E: 'crouch_strong',
  0x0008FAAA: 'crouch_fierce',
  0x0008FB3E: 'crouch_short',
  0x0008FBBA: 'crouch_mk',
  0x0008FC36: 'sweep',
  // ── Standing normals ──
  0x0008F39E: 'standing_jab',
  0x0008F4DE: 'standing_strong',
  0x0008F606: 'standing_fierce',
  0x0008F716: 'standing_short',
  0x0008F826: 'standing_forward',
  0x0008F91E: 'standing_rh',
  // ── Specials ──
  // Hadoukens anchor on state-entry (projectile owns the attackbox, Ken's is null).
  0x0009032A: 'hadouken_jab',
  0x0009038E: 'hadouken_strong',
  0x000903F2: 'hadouken_fierce',
  0x0009046E: 'shoryu_jab',
  0x0009051A: 'shoryu_strong',
  0x000905C6: 'shoryu_fierce',
  0x000906D6: 'tatsu_lk',
  0x00090752: 'tatsu_mk',
  0x000907CE: 'tatsu_hk',
  // ── Jump attacks (forward canonical — back jumps share the same
  //    attackbox animation, only direction differs) ──
  0x0008FFFA: 'jump_forward_lp',
  0x00090046: 'jump_forward_mp',
  0x000900F2: 'jump_forward_hp',
  0x0009019E: 'jump_forward_lk',
  0x00090202: 'jump_forward_mk',
  0x000902AE: 'jump_forward_hk',
  // ── Neutral jumps ──
  0x0008FCCA: 'jump_neutral_lp',
  0x0008FD16: 'jump_neutral_mp',
  0x0008FDC2: 'jump_neutral_hp',
  0x0008FE56: 'jump_neutral_lk',
  0x0008FED2: 'jump_neutral_mk',
  0x0008FF4E: 'jump_neutral_hk',
  // ── Air tatsus ──
  0x0009087A: 'air_tatsu_lk',
  0x000908F6: 'air_tatsu_mk',
  0x00090942: 'air_tatsu_hk',
};

/**
 * Reverse lookup: ActionId → startup animPtr. Built once at module
 * load. Used by the forward simulator when deciding "if Ken launches
 * ActionId X, where will its attackbox be at frame N?".
 */
const KEN_ACTION_TO_ANIMPTR = ((): Partial<Record<ActionId, number>> => {
  const out: Partial<Record<ActionId, number>> = {};
  for (const [ptrStr, action] of Object.entries(KEN_ANIMPTR_TO_ACTION)) {
    out[action] = Number(ptrStr);
  }
  return out;
})();

export function kenAnimPtrFor(action: ActionId): number | null {
  return KEN_ACTION_TO_ANIMPTR[action] ?? null;
}
