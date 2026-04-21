import type { ComboScript } from '../types';
import { role } from '../resolvers';

/**
 * COMBO tier — every offensive window covered. Weights are damage
 * ratios as fraction of the 144 HP bar (0.35 = ~50 HP). The tier-
 * runner picks the MAX-damage eligible combo deterministically, so
 * Ken always spends each opening on the best return possible.
 */
export const COMBO_SCRIPTS: readonly ComboScript[] = [
  // ── Close pressure BnB (c.LK×2 → c.MK xx Hadouken) — 4-hit ≈ 35% ──
  {
    name: 'bnb_cLK_cLK_cMK_hadouken',
    tag: 'bnb', weight: 0.35,
    if: ['p1_attacking_normal', 'dist_close'],
    steps: [
      { do: 'crouch_short' },
      { do: 'crouch_short', delayBeforeFrames: 4 },
      { do: 'crouch_mk',    delayBeforeFrames: 4 },
      { do: role('fireball_strong') },
    ],
  },

  // ── Anti-air DP → Hadouken on wake-up — 2-hit ≈ 28% ──────────────
  {
    name: 'bnb_antiair_DP_zone',
    tag: 'bnb', weight: 0.28,
    if: ['p1_jump_forward', 'dist_close'],
    steps: [
      { do: role('anti_air') },
      { do: role('fireball_strong'), delayBeforeFrames: 30 },
    ],
  },

  // ── Anti-air mid-range — 1-hit shoryu knockdown ≈ 20% ────────────
  {
    name: 'antiair_mid_DP',
    tag: 'bnb', weight: 0.20,
    if: ['p1_jump_forward', 'dist_mid'],
    steps: [
      { do: role('anti_air') },
    ],
  },

  // ── Crossup reset (j.MK → c.LK → c.MK xx Shoryu) — 4-hit ≈ 40% ───
  {
    name: 'style_crossup_jMK_cLK_cMK_shoryu',
    tag: 'style', weight: 0.40,
    if: ['p1_crouching', 'dist_close'],
    steps: [
      { do: 'jump_forward_mk' },
      { do: 'crouch_short', delayBeforeFrames: 2 },
      { do: 'crouch_mk',    delayBeforeFrames: 4 },
      { do: role('anti_air') },
    ],
  },

  // ── Dizzy TOD (j.HK → c.MP → c.MK xx Shoryu fierce) ≈ 55% ────────
  {
    name: 'tod_dizzy_jHK_cMP_cMK_shoryu',
    tag: 'tod', weight: 0.55,
    if: ['p1_stunned', 'dist_close'],
    steps: [
      { do: 'jump_forward_hk' },
      { do: 'crouch_strong', delayBeforeFrames: 2 },
      { do: 'crouch_mk',     delayBeforeFrames: 4 },
      { do: role('anti_air') },
    ],
  },

  // ── Dizzy at mid distance — walk-forward first, then TOD ─────────
  {
    name: 'tod_dizzy_approach_jHK',
    tag: 'tod', weight: 0.48,
    if: ['p1_stunned', 'dist_mid'],
    steps: [
      { do: 'walk_forward' },
      { do: 'jump_forward_hk', delayBeforeFrames: 6 },
      { do: 'crouch_mk',       delayBeforeFrames: 4 },
      { do: role('anti_air') },
    ],
  },

  // ── Whiff-punish (sweep → Hadouken OTG) — 2-hit ≈ 25% ────────────
  {
    name: 'whiff_punish_sweep_hadouken',
    tag: 'bnb', weight: 0.25,
    if: ['p1_whiffed_special'],
    steps: [
      { do: 'sweep' },
      { do: role('fireball_strong'), delayBeforeFrames: 20 },
    ],
  },

  // ── Normal-recovery punish (c.MK xx Shoryu) — 2-hit ≈ 30% ────────
  {
    name: 'recovery_cMK_shoryu',
    tag: 'bnb', weight: 0.30,
    if: ['p1_recovery_normal'],
    steps: [
      { do: 'crouch_mk' },
      { do: role('anti_air') },
    ],
  },

  // ── Idle close → overhead jump-in BnB — 3-hit ≈ 38% ──────────────
  {
    name: 'neutral_close_jHP_cMK_hadouken',
    tag: 'bnb', weight: 0.38,
    if: ['p1_idle', 'dist_close'],
    steps: [
      { do: 'jump_forward_hp' },
      { do: 'crouch_mk', delayBeforeFrames: 2 },
      { do: role('fireball_strong') },
    ],
  },

  // ── Touch range idle → throw ≈ 15% damage ────────────────────────
  {
    name: 'touch_throw_reset',
    tag: 'reset', weight: 0.15,
    if: ['p1_idle', 'dist_touch'],
    steps: [
      { do: 'throw_forward' },
    ],
  },

  // ── Touch during attack → tech throw ≈ 15% ───────────────────────
  {
    name: 'touch_tech_attacker',
    tag: 'bnb', weight: 0.15,
    if: ['p1_attacking_normal', 'dist_touch'],
    steps: [
      { do: 'throw_forward' },
    ],
  },

  // ── Touch on crouching P1 → guaranteed throw ≈ 15% ───────────────
  {
    name: 'touch_crouch_throw',
    tag: 'reset', weight: 0.15,
    if: ['p1_crouching', 'dist_touch'],
    steps: [
      { do: 'throw_forward' },
    ],
  },

  // ── Mid-range approach → jump-in HK BnB — 4-hit ≈ 42% ────────────
  {
    name: 'approach_jHK_cLK_cMK_fireball',
    tag: 'bnb', weight: 0.42,
    if: ['p1_idle', 'dist_mid'],
    steps: [
      { do: 'jump_forward_hk' },
      { do: 'crouch_short', delayBeforeFrames: 2 },
      { do: 'crouch_mk',    delayBeforeFrames: 4 },
      { do: role('fireball_strong') },
    ],
  },

  // ── Walking-back chase → jump-in into cancel DP ≈ 40% ────────────
  {
    name: 'chase_retreat_jHK_cMK',
    tag: 'bnb', weight: 0.40,
    if: ['p1_walking_back', 'dist_mid'],
    steps: [
      { do: 'jump_forward_hk' },
      { do: 'crouch_mk', delayBeforeFrames: 2 },
      { do: role('anti_air') },
    ],
  },

  // ── Walking-forward counter → long poke xx cancel ≈ 25% ──────────
  {
    name: 'counter_walking_forward',
    tag: 'bnb', weight: 0.25,
    if: ['p1_walking_forward', 'dist_mid'],
    steps: [
      { do: 'standing_rh' },
      { do: role('fireball_strong'), delayBeforeFrames: 18 },
    ],
  },

  // ── Jump-back chase → fireball + jump-in close ≈ 30% ─────────────
  {
    name: 'chase_jump_back',
    tag: 'bnb', weight: 0.30,
    if: ['p1_jump_back'],
    steps: [
      { do: role('fireball_strong') },
      { do: 'jump_forward_hk', delayBeforeFrames: 18 },
    ],
  },

  // ── Corner kill (sweep → Hadouken OTG) ≈ 25% ─────────────────────
  {
    name: 'corner_kill_sweep_hadouken',
    tag: 'tod', weight: 0.25,
    if: ['cornered_them', 'dist_close'],
    steps: [
      { do: 'sweep' },
      { do: role('fireball_strong'), delayBeforeFrames: 18 },
    ],
  },

  // ── Corner BnB at touch range — throw + Hadouken OTG ≈ 28% ───────
  {
    name: 'corner_kill_touch_throw',
    tag: 'tod', weight: 0.28,
    if: ['cornered_them', 'dist_touch'],
    steps: [
      { do: 'throw_forward' },
      { do: role('fireball_strong'), delayBeforeFrames: 20 },
    ],
  },

  // ── Reversal from the corner (DP → zone) ≈ 28% ───────────────────
  {
    name: 'corner_escape_DP_zone',
    tag: 'bnb', weight: 0.28,
    if: ['cornered_me'],
    steps: [
      { do: role('anti_air') },
      { do: role('fireball_strong'), delayBeforeFrames: 30 },
    ],
  },

  // ── Fullscreen idle → fireball-zone + forward step ≈ 12% ─────────
  {
    name: 'fullscreen_zone_walkup',
    tag: 'bnb', weight: 0.12,
    if: ['p1_idle', 'dist_fullscreen'],
    steps: [
      { do: role('fireball_strong') },
      { do: 'walk_forward', delayBeforeFrames: 4 },
    ],
  },

  // ── Far range zoning + follow-up jump-in ≈ 20% ───────────────────
  {
    name: 'far_zone_then_jumpin',
    tag: 'bnb', weight: 0.20,
    if: ['p1_idle', 'dist_far'],
    steps: [
      { do: role('fireball_strong') },
      { do: 'jump_forward_hk', delayBeforeFrames: 18 },
      { do: 'crouch_mk',       delayBeforeFrames: 4 },
    ],
  },

  // ── Jump-neutral punish at mid range — approach combo ≈ 35% ──────
  {
    name: 'neutral_jump_punish',
    tag: 'bnb', weight: 0.35,
    if: ['p1_jump_neutral', 'dist_mid'],
    steps: [
      { do: 'walk_forward' },
      { do: role('anti_air'), delayBeforeFrames: 8 },
    ],
  },
];
