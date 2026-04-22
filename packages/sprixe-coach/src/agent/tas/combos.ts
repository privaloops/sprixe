import type { InputFrame, VirtualButton } from '../input-sequencer';

/**
 * Ken SF2HF combo library — pre-chained input frames, facing LEFT.
 * Sources: supercombo wiki (SSF2T Ken), mikesarcade SF2 Ken guide,
 * T.Akiba SF2 data. Links tuned for HF cancel windows (cancelable
 * normals: cHP, sHP close, cMK, sMK; DP cancel window ~19f on hit).
 *
 * Every combo is a single InputFrame[] queued atomically into the
 * sequencer — no re-decision between hits. The pilot just flips
 * left/right based on facing before pushing.
 */

export type ComboId =
  // Ground punishes
  | 'ground_chp_dp'        // cHP xx fierce DP — close punish, max dmg (34f recovery on whiff)
  | 'ground_chp_jab_dp'    // cHP xx jab DP — safer variant (24f recovery on whiff)
  | 'ground_cmk_fb'        // cMK xx fierce Hadouken — mid punish
  | 'ground_cmk_dp'        // cMK xx fierce DP — mid punish, 3 hits max dmg
  | 'ground_shp_dp'        // sHP xx fierce DP — alt close punish
  // Jump-in BnBs
  | 'bnb_jhk_chp_dp'       // jHK → cHP xx fierce DP — killer BnB
  | 'bnb_jhp_chp_dp'       // jHP → cHP xx fierce DP — punch jump-in
  | 'bnb_jhk_shp_dp'       // jHK → sHP xx fierce DP — variant
  | 'bnb_jhk_cmk_fb'       // jHK → cMK xx fierce Hadouken — safe
  | 'bnb_jhp_chp_fb'       // jHP → cHP xx fierce Hadouken — safe punch combo
  // Corner carry / lockdown
  | 'corner_chp_tatsu'     // cHP xx HK Tatsu — corner, no jump-in
  | 'bnb_jhk_chp_tatsu'    // jHK → cHP xx HK Tatsu — corner jump-in
  // Tick setups
  | 'tick_clk_clk_dp'      // cLK → cLK xx jab DP — tick hit-confirm
  | 'tick_clk_clk_throw'   // cLK → cLK → throw — tick mixup
  // Stun TOD
  | 'stun_jhk_chp_dp'      // identical frames to bnb_jhk_chp_dp, tagged
  // Anti-air
  | 'aa_fierce_dp';        // fierce DP — 2 hits if close

// ── Motion primitives (P2 facing left) ──────────────────────────
// Kept inline rather than imported from actions.ts so we can tune
// gaps between parts without leaking into the base motion table.

// ── Motion primitives — MINIMUM FRAMES.
// SF2 input buffer is ~8 frames; 1 frame per direction poll suffices.

const dp = (btn: VirtualButton): InputFrame[] => [
  { held: ['left'],              frames: 1 },
  { held: ['down'],              frames: 1 },
  { held: ['down', 'left', btn], frames: 1 },
];

const hadouken = (btn: VirtualButton): InputFrame[] => [
  { held: ['down'],         frames: 1 },
  { held: ['down', 'left'], frames: 1 },
  { held: ['left', btn],    frames: 1 },
];

// qcb+K — for P2 facing left, back=right so motion is down, down-right, right.
// Character travels forward (toward P1) regardless of facing.
const tatsuBack = (btn: VirtualButton): InputFrame[] => [
  { held: ['down'],          frames: 1 },
  { held: ['down', 'right'], frames: 1 },
  { held: ['right', btn],    frames: 1 },
];

// Normals — 1 frame D+button simultaneous. Hit-freeze after the
// normal lands gives ~8 frames to buffer the special cancel.
const cHP: InputFrame[] = [{ held: ['down', 'button3'], frames: 1 }];
const sHP: InputFrame[] = [{ held: ['button3'],         frames: 1 }];
const cMK: InputFrame[] = [{ held: ['down', 'button5'], frames: 1 }];
const cLK: InputFrame[] = [{ held: ['down', 'button4'], frames: 1 }];

// Jump-in — press Up+dir once, hold dir during ascent (1 frame of
// up is enough to start the physics), add attack button near apex,
// release before landing. Total span covers the 28-frame jump arc
// so the pilot doesn't re-decide mid-air.
const jumpInHK: InputFrame[] = [
  { held: ['left', 'up'],        frames: 1 },
  { held: ['left'],              frames: 10 },
  { held: ['left', 'button6'],   frames: 3 },
  { held: [],                    frames: 14 },
];

const jumpInHP: InputFrame[] = [
  { held: ['left', 'up'],        frames: 1 },
  { held: ['left'],              frames: 10 },
  { held: ['left', 'button3'],   frames: 3 },
  { held: [],                    frames: 14 },
];


export function resolveCombo(id: ComboId): InputFrame[] {
  switch (id) {
    case 'ground_chp_dp':
      return [...cHP, ...dp('button3')];
    case 'ground_chp_jab_dp':
      return [...cHP, ...dp('button1')];
    case 'ground_shp_dp':
      return [...sHP, ...dp('button3')];
    case 'ground_cmk_fb':
      return [...cMK, ...hadouken('button3')];
    case 'ground_cmk_dp':
      return [...cMK, ...dp('button3')];

    case 'bnb_jhk_chp_dp':
    case 'stun_jhk_chp_dp':
      return [...jumpInHK, ...cHP, ...dp('button3')];
    case 'bnb_jhp_chp_dp':
      return [...jumpInHP, ...cHP, ...dp('button3')];
    case 'bnb_jhk_shp_dp':
      return [...jumpInHK, ...sHP, ...dp('button3')];
    case 'bnb_jhk_cmk_fb':
      return [...jumpInHK, ...cMK, ...hadouken('button3')];
    case 'bnb_jhp_chp_fb':
      return [...jumpInHP, ...cHP, ...hadouken('button3')];

    case 'corner_chp_tatsu':
      return [...cHP, ...tatsuBack('button6')];
    case 'bnb_jhk_chp_tatsu':
      return [...jumpInHK, ...cHP, ...tatsuBack('button6')];

    case 'tick_clk_clk_dp':
      return [
        ...cLK,
        { held: ['down'], frames: 3 },
        ...cLK,
        { held: ['down'], frames: 1 },
        ...dp('button1'),
      ];
    case 'tick_clk_clk_throw':
      return [
        ...cLK,
        { held: ['down'], frames: 3 },
        ...cLK,
        { held: [],                       frames: 2 },
        { held: ['left', 'button3'],      frames: 4 },
        { held: [],                       frames: 2 },
      ];

    case 'aa_fierce_dp':
      return dp('button3');
  }
}
