import type { ActionId } from '../policy/types';

/**
 * Empirical Ken move timelines — `(animPtr, holdFrames)[]` for each
 * action, captured live via `KenTimelineRecorder` (`?record-ken=1`).
 *
 * The stride-linear ROM walk turned out to be wrong: SF2HF holds each
 * animation frame for a move-specific vblank count that is NOT encoded
 * in the 24-byte frame struct (probably in the 68K move code). So we
 * record the actual sequence once and look it up at predict time.
 *
 * To update: run the recorder, fire each move, paste the emitted TS
 * block here.
 */
export interface TimelineEntry {
  /** Absolute ROM pointer to the 24-byte animation frame struct. */
  animPtr: number;
  /** Vblanks this frame is held before the animation advances. */
  frames: number;
}

export type MoveTimeline = readonly TimelineEntry[];

export const KEN_MOVE_TIMELINES: Partial<Record<ActionId, MoveTimeline>> = {
  // Each timeline starts at the animPtr the validator anchors on.
  // For moves with a live attackbox (normals / shoryu / tatsu / jumps)
  // that means "first attackbox-active frame" (pre-active startup
  // frames trimmed). For projectiles (hadoukens) where Ken has no
  // attackbox, the anchor is the state-entry animPtr.
  //
  // Captured via `?ai=1&calibrate-ken=1&record-ken=1`: the calibration
  // pilot fires each Ken motion in isolation, the recorder dumps the
  // observed (animPtr, holdFrames)[] sequence. The calibration emits
  // the per-move anchor animPtr, which is used here to trim wrappers.
  //
  // jump_back_* intentionally omitted — they share the same attack
  // animation as jump_forward_* (only direction differs, attackbox is
  // identical). actionForAnimPtr() returns the forward variant, so
  // that's what the validator looks up.
  //
  // hadouken_fierce timeline is retained from an earlier capture —
  // the last calibration run misfired (input motion came out as
  // standing_fierce). Re-capture when motion timing is fixed.

  // ── Crouch normals ──
  crouch_jab: [
    { animPtr: 0x0008F9B2, frames: 2 },
    { animPtr: 0x0008F9CA, frames: 3 },
    { animPtr: 0x0008F9E2, frames: 1 },
  ],
  crouch_strong: [
    { animPtr: 0x0008FA2E, frames: 3 },
    { animPtr: 0x0008FA46, frames: 2 },
    { animPtr: 0x0008FA5E, frames: 2 },
    { animPtr: 0x0008FA76, frames: 1 },
  ],
  crouch_fierce: [
    { animPtr: 0x0008FAAA, frames: 3 },
    { animPtr: 0x0008FAC2, frames: 5 },
    { animPtr: 0x0008FADA, frames: 8 },
    { animPtr: 0x0008FAF2, frames: 8 },
    { animPtr: 0x0008FB0A, frames: 1 },
  ],
  crouch_short: [
    { animPtr: 0x0008FB3E, frames: 3 },
    { animPtr: 0x0008FB56, frames: 2 },
    { animPtr: 0x0008FB6E, frames: 1 },
  ],
  crouch_mk: [
    { animPtr: 0x0008FBBA, frames: 4 },
    { animPtr: 0x0008FBD2, frames: 3 },
    { animPtr: 0x0008FBEA, frames: 3 },
    { animPtr: 0x0008FC02, frames: 1 },
  ],
  sweep: [
    { animPtr: 0x0008FC36, frames: 5 },
    { animPtr: 0x0008FC4E, frames: 4 },
    { animPtr: 0x0008FC66, frames: 6 },
    { animPtr: 0x0008FC7E, frames: 7 },
    { animPtr: 0x0008FC96, frames: 1 },
  ],

  // ── Standing normals ──
  standing_jab: [
    { animPtr: 0x0008F39E, frames: 3 },
    { animPtr: 0x0008F3B6, frames: 3 },
    { animPtr: 0x0008F3CE, frames: 1 },
  ],
  standing_strong: [
    { animPtr: 0x0008F4DE, frames: 3 },
    { animPtr: 0x0008F4F6, frames: 2 },
    { animPtr: 0x0008F50E, frames: 2 },
    { animPtr: 0x0008F526, frames: 1 },
  ],
  standing_fierce: [
    { animPtr: 0x0008F606, frames: 5 },
    { animPtr: 0x0008F61E, frames: 7 },
    { animPtr: 0x0008F636, frames: 9 },
    { animPtr: 0x0008F64E, frames: 1 },
  ],
  standing_short: [
    { animPtr: 0x0008F716, frames: 7 },
    { animPtr: 0x0008F72E, frames: 3 },
  ],
  standing_forward: [
    { animPtr: 0x0008F826, frames: 9 },
    { animPtr: 0x0008F83E, frames: 5 },
    { animPtr: 0x0008F856, frames: 1 },
  ],
  standing_rh: [
    { animPtr: 0x0008F91E, frames: 3 },
    { animPtr: 0x0008F936, frames: 6 },
    { animPtr: 0x0008F94E, frames: 7 },
    { animPtr: 0x0008F966, frames: 4 },
    { animPtr: 0x0008F97E, frames: 1 },
  ],

  // ── Specials ──
  hadouken_jab: [
    { animPtr: 0x0009032A, frames: 2 },
    { animPtr: 0x00090342, frames: 6 },
    { animPtr: 0x0009035A, frames: 1 },
    { animPtr: 0x00090372, frames: 30 },
  ],
  hadouken_strong: [
    { animPtr: 0x0009038E, frames: 2 },
    { animPtr: 0x000903A6, frames: 6 },
    { animPtr: 0x000903BE, frames: 2 },
    { animPtr: 0x000903D6, frames: 31 },
  ],
  hadouken_fierce: [
    { animPtr: 0x000903F2, frames: 2 },
    { animPtr: 0x0009040A, frames: 6 },
    { animPtr: 0x00090422, frames: 2 },
    { animPtr: 0x0009043A, frames: 44 },
  ],
  shoryu_jab: [
    { animPtr: 0x0009046E, frames: 4 },
    { animPtr: 0x00090486, frames: 10 },
    { animPtr: 0x0009049E, frames: 5 },
    { animPtr: 0x000904B6, frames: 8 },
    { animPtr: 0x000904E6, frames: 2 },
  ],
  shoryu_strong: [
    { animPtr: 0x0009051A, frames: 3 },
    { animPtr: 0x00090532, frames: 17 },
    { animPtr: 0x0009054A, frames: 4 },
    { animPtr: 0x00090562, frames: 11 },
    { animPtr: 0x00090592, frames: 2 },
  ],
  shoryu_fierce: [
    { animPtr: 0x000905C6, frames: 3 },
    { animPtr: 0x000905DE, frames: 19 },
    { animPtr: 0x000905F6, frames: 5 },
    { animPtr: 0x0009060E, frames: 15 },
    { animPtr: 0x00090626, frames: 1 },
    { animPtr: 0x0009063E, frames: 1 },
  ],
  tatsu_lk: [
    { animPtr: 0x000906D6, frames: 11 },
    { animPtr: 0x000906EE, frames: 1 },
    { animPtr: 0x00090706, frames: 2 },
    { animPtr: 0x00090736, frames: 1 },
    { animPtr: 0x000906D6, frames: 2 },
    { animPtr: 0x00090706, frames: 2 },
    { animPtr: 0x0009071E, frames: 1 },
    { animPtr: 0x000906D6, frames: 2 },
    { animPtr: 0x000906EE, frames: 1 },
    { animPtr: 0x00090706, frames: 1 },
    { animPtr: 0x0009071E, frames: 1 },
    { animPtr: 0x00090736, frames: 1 },
    { animPtr: 0x000909BE, frames: 2 },
    { animPtr: 0x000909D6, frames: 3 },
    { animPtr: 0x000909EE, frames: 3 },
    { animPtr: 0x00091282, frames: 5 },
  ],
  tatsu_mk: [
    { animPtr: 0x00090752, frames: 11 },
    { animPtr: 0x0009076A, frames: 1 },
    { animPtr: 0x00090782, frames: 1 },
    { animPtr: 0x0009079A, frames: 1 },
    { animPtr: 0x000907B2, frames: 1 },
    { animPtr: 0x00090752, frames: 1 },
    { animPtr: 0x0009076A, frames: 1 },
    { animPtr: 0x00090782, frames: 2 },
    { animPtr: 0x000907B2, frames: 1 },
    { animPtr: 0x00090752, frames: 12 },
    { animPtr: 0x0009076A, frames: 1 },
    { animPtr: 0x00090782, frames: 1 },
    { animPtr: 0x0009079A, frames: 1 },
    { animPtr: 0x000907B2, frames: 1 },
    { animPtr: 0x00090752, frames: 1 },
    { animPtr: 0x0009076A, frames: 1 },
    { animPtr: 0x00090782, frames: 2 },
    { animPtr: 0x0009079A, frames: 1 },
    { animPtr: 0x000907B2, frames: 1 },
    { animPtr: 0x000909BE, frames: 2 },
    { animPtr: 0x000909D6, frames: 3 },
    { animPtr: 0x000909EE, frames: 3 },
    { animPtr: 0x00091282, frames: 5 },
  ],
  tatsu_hk: [
    { animPtr: 0x000907CE, frames: 11 },
    { animPtr: 0x000907E6, frames: 1 },
    { animPtr: 0x000907FE, frames: 1 },
    { animPtr: 0x00090816, frames: 1 },
    { animPtr: 0x0009082E, frames: 1 },
    { animPtr: 0x000907CE, frames: 1 },
    { animPtr: 0x000907E6, frames: 1 },
    { animPtr: 0x000907FE, frames: 1 },
    { animPtr: 0x00090816, frames: 1 },
    { animPtr: 0x0009082E, frames: 1 },
    { animPtr: 0x000907CE, frames: 11 },
    { animPtr: 0x000907E6, frames: 1 },
    { animPtr: 0x000907FE, frames: 2 },
    { animPtr: 0x0009082E, frames: 1 },
    { animPtr: 0x000907CE, frames: 2 },
    { animPtr: 0x000907FE, frames: 2 },
    { animPtr: 0x0009082E, frames: 1 },
    { animPtr: 0x000907CE, frames: 12 },
    { animPtr: 0x000907E6, frames: 1 },
    { animPtr: 0x000907FE, frames: 1 },
    { animPtr: 0x00090816, frames: 1 },
    { animPtr: 0x0009082E, frames: 1 },
    { animPtr: 0x000909BE, frames: 2 },
    { animPtr: 0x000909D6, frames: 3 },
    { animPtr: 0x000909EE, frames: 3 },
    { animPtr: 0x00090A06, frames: 1 },
    { animPtr: 0x00091282, frames: 4 },
  ],

  // ── Jump attacks (forward) ──
  jump_forward_lp: [
    { animPtr: 0x0008FFFA, frames: 23 },
    { animPtr: 0x00091282, frames: 5 },
  ],
  jump_forward_mp: [
    { animPtr: 0x00090046, frames: 6 },
    { animPtr: 0x0009005E, frames: 3 },
    { animPtr: 0x00090076, frames: 3 },
    { animPtr: 0x0009008E, frames: 3 },
    { animPtr: 0x000900A6, frames: 6 },
    { animPtr: 0x00091282, frames: 5 },
  ],
  jump_forward_hp: [
    { animPtr: 0x000900F2, frames: 6 },
    { animPtr: 0x0009010A, frames: 3 },
    { animPtr: 0x00090122, frames: 5 },
    { animPtr: 0x0009013A, frames: 3 },
    { animPtr: 0x00090152, frames: 6 },
    { animPtr: 0x00091282, frames: 5 },
  ],
  jump_forward_lk: [
    { animPtr: 0x0009019E, frames: 32 },
    { animPtr: 0x00091282, frames: 6 },
  ],
  jump_forward_mk: [
    { animPtr: 0x00090202, frames: 10 },
    { animPtr: 0x0009021A, frames: 2 },
    { animPtr: 0x00090232, frames: 2 },
    { animPtr: 0x0009024A, frames: 2 },
    { animPtr: 0x00090262, frames: 4 },
    { animPtr: 0x00091282, frames: 5 },
  ],
  jump_forward_hk: [
    { animPtr: 0x000902AE, frames: 5 },
    { animPtr: 0x000902C6, frames: 3 },
    { animPtr: 0x000902DE, frames: 2 },
    { animPtr: 0x000902F6, frames: 2 },
    { animPtr: 0x0009030E, frames: 8 },
    { animPtr: 0x00091282, frames: 6 },
  ],

  // ── Jump attacks (neutral) ──
  jump_neutral_lp: [
    { animPtr: 0x0008FCCA, frames: 33 },
    { animPtr: 0x00091282, frames: 5 },
  ],
  jump_neutral_mp: [
    { animPtr: 0x0008FD16, frames: 15 },
    { animPtr: 0x0008FD2E, frames: 3 },
    { animPtr: 0x0008FD46, frames: 3 },
    { animPtr: 0x0008FD5E, frames: 1 },
    { animPtr: 0x00091282, frames: 5 },
  ],
  jump_neutral_hp: [
    { animPtr: 0x0008FDC2, frames: 14 },
    { animPtr: 0x0008FDDA, frames: 3 },
    { animPtr: 0x0008FDF2, frames: 3 },
    { animPtr: 0x0008FE0A, frames: 1 },
    { animPtr: 0x00091282, frames: 6 },
  ],
  jump_neutral_lk: [
    { animPtr: 0x0008FE56, frames: 22 },
    { animPtr: 0x00091282, frames: 5 },
  ],
  jump_neutral_mk: [
    { animPtr: 0x0008FED2, frames: 10 },
    { animPtr: 0x0008FEEA, frames: 4 },
    { animPtr: 0x0008FF02, frames: 5 },
    { animPtr: 0x0008FF1A, frames: 3 },
    { animPtr: 0x00091282, frames: 5 },
  ],
  jump_neutral_hk: [
    { animPtr: 0x0008FF4E, frames: 3 },
    { animPtr: 0x0008FF66, frames: 4 },
    { animPtr: 0x0008FF7E, frames: 3 },
    { animPtr: 0x0008FF96, frames: 2 },
    { animPtr: 0x0008FFAE, frames: 2 },
    { animPtr: 0x0008FFC6, frames: 9 },
    { animPtr: 0x00091282, frames: 5 },
  ],

  // ── Air tatsus ──
  air_tatsu_lk: [
    { animPtr: 0x0009087A, frames: 2 },
    { animPtr: 0x000908AA, frames: 1 },
    { animPtr: 0x0009084A, frames: 2 },
    { animPtr: 0x0009087A, frames: 2 },
    { animPtr: 0x000908AA, frames: 1 },
    { animPtr: 0x0009084A, frames: 2 },
    { animPtr: 0x0009087A, frames: 2 },
    { animPtr: 0x00090892, frames: 1 },
    { animPtr: 0x00090A3A, frames: 2 },
    { animPtr: 0x00090A52, frames: 3 },
    { animPtr: 0x00090A6A, frames: 3 },
    { animPtr: 0x00090A82, frames: 3 },
    { animPtr: 0x00090A9A, frames: 2 },
    { animPtr: 0x00091282, frames: 5 },
  ],
  air_tatsu_mk: [
    { animPtr: 0x000908F6, frames: 2 },
    { animPtr: 0x00090926, frames: 1 },
    { animPtr: 0x000908C6, frames: 1 },
    { animPtr: 0x000908DE, frames: 1 },
    { animPtr: 0x000908F6, frames: 2 },
    { animPtr: 0x00090926, frames: 1 },
    { animPtr: 0x000908C6, frames: 2 },
    { animPtr: 0x000908F6, frames: 2 },
    { animPtr: 0x00090926, frames: 1 },
    { animPtr: 0x00090A3A, frames: 2 },
    { animPtr: 0x00090A52, frames: 3 },
    { animPtr: 0x00090A6A, frames: 3 },
    { animPtr: 0x00090A82, frames: 3 },
    { animPtr: 0x00090A9A, frames: 4 },
    { animPtr: 0x00091282, frames: 4 },
  ],
  air_tatsu_hk: [
    { animPtr: 0x00090942, frames: 1 },
    { animPtr: 0x0009095A, frames: 1 },
    { animPtr: 0x00090972, frames: 1 },
    { animPtr: 0x0009098A, frames: 1 },
    { animPtr: 0x000909A2, frames: 1 },
    { animPtr: 0x00090942, frames: 1 },
    { animPtr: 0x0009095A, frames: 1 },
    { animPtr: 0x00090972, frames: 1 },
    { animPtr: 0x0009098A, frames: 1 },
    { animPtr: 0x000909A2, frames: 1 },
    { animPtr: 0x00090942, frames: 1 },
    { animPtr: 0x0009095A, frames: 1 },
    { animPtr: 0x00090972, frames: 1 },
    { animPtr: 0x0009098A, frames: 1 },
    { animPtr: 0x000909A2, frames: 1 },
    { animPtr: 0x00090942, frames: 1 },
    { animPtr: 0x0009095A, frames: 1 },
    { animPtr: 0x00090972, frames: 2 },
    { animPtr: 0x000909A2, frames: 1 },
    { animPtr: 0x00090A3A, frames: 2 },
    { animPtr: 0x00090A52, frames: 3 },
    { animPtr: 0x00090A6A, frames: 3 },
    { animPtr: 0x00090A82, frames: 3 },
    { animPtr: 0x00090A9A, frames: 4 },
    { animPtr: 0x00091282, frames: 5 },
  ],
};

/**
 * Walk a timeline forward by `frameOffset` frames (0-based) and return
 * the animPtr active at that frame. Returns null if the offset runs
 * past the end of the timeline (move finished).
 */
export function animPtrAtFrame(timeline: MoveTimeline, frameOffset: number): number | null {
  if (frameOffset < 0) return null;
  let acc = 0;
  for (const entry of timeline) {
    if (frameOffset < acc + entry.frames) return entry.animPtr;
    acc += entry.frames;
  }
  return null;
}
