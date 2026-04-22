import type { HitboxRect } from '../../types';
import type { ActionId } from '../policy/types';
import {
  resolveBoxFromRom,
  readRomByte,
  ATTACK_BOX_SPEC,
  SF2HF_BOX_SPECS,
  FRAME_STRIDE,
  type BoxSpec,
} from './box-predictor';
import { KEN_MOVE_TIMELINES, type MoveTimeline } from './ken-move-timelines';

/**
 * Offline punish-range matrix: for every (Ken attack, Ryu victim) move
 * pair, compute the maximum centre-to-centre distance at which Ken's
 * attackbox can overlap any of Ryu's hurtboxes while both moves play
 * their animation.
 *
 * Why this is useful: during Ryu's sweep his leg hurtbox juts out far
 * in front of him — a Ken c.LK that never reaches Ryu idle can still
 * catch the extended leg. The matrix encodes that per-frame geometry.
 *
 * Strategy:
 *   1. Ken: walk the calibrated KEN_MOVE_TIMELINES (animPtr per held frame).
 *   2. Ryu: no calibrated timelines yet. Walk the 24-byte frame stride
 *      from the startup animPtr until we read a frame whose box IDs are
 *      all zero (animation end) or hit a hard cap of 40 frames.
 *   3. For every (ken_frame, ryu_frame) pair, resolve boxes and compute
 *      the max hit distance using the separable "reach + hurt extent"
 *      approximation (assumes the two characters face each other on a
 *      flat horizontal axis).
 *
 * Output is a per-Ken-move record with the best (farthest) match against
 * each Ryu move, plus the frame indices that produced it.
 */

const HURT_SPECS: readonly BoxSpec[] = SF2HF_BOX_SPECS.filter(
  (s) => s.kind === 'hurt_head' || s.kind === 'hurt_body' || s.kind === 'hurt_legs',
);

const RYU_MAX_FRAMES = 40;
const KEN_MAX_FRAMES = 20;

/** Known Ryu move startup animPtrs, from detector/move-names.ts.
 *  Only startup pointers are reliable; we derive the rest by stride. */
export const RYU_MOVE_STARTUPS: Readonly<Record<string, number>> = {
  standing_jab:        0x0005FBA2,
  standing_strong:     0x0005FCCA,
  standing_fierce:     0x0005FDF2,
  standing_short:      0x0005FF02,
  standing_forward:    0x00060012,
  standing_roundhouse: 0x00060122,
  crouching_jab:       0x000601B6,
  sweep:               0x0006043A,
  jumping_jab:         0x000607FE,
  jumping_strong:      0x00060832,
  jumping_fierce:      0x000608DE,
  hadouken_jab:        0x00060CCE,
  hadouken_strong:     0x00060D32,
  hadouken_fierce:     0x00060D96,
  shoryuken_jab:       0x00060DFA,
  shoryuken_strong:    0x00060EA6,
  shoryuken_fierce:    0x00060F52,
  tatsumaki:           0x00060FFE,
};

export interface PairResult {
  /** Max centre-to-centre distance where Ken's attack still catches any
   *  Ryu hurtbox. -Infinity means no frame pair connects. */
  maxHitDist: number;
  /** Ken timeline index that produced the best hit. */
  kenFrame: number;
  /** Ryu frame index (0 = startup) that produced the best hit. */
  ryuFrame: number;
  /** Ryu hurtbox kind that was caught. */
  hurtKind: HitboxRect['kind'] | null;
}

export type KenRyuMatrix = Record<string, Record<string, PairResult>>;

interface Context {
  rom: Uint8Array;
  kenHitboxPtr: number;
  ryuHitboxPtr: number;
}

/**
 * Derive a character's per-frame animPtrs by walking FRAME_STRIDE-sized
 * steps. Stops when:
 *   - all four box IDs read 0 (animation blank frame), or
 *   - the next stride lands on another known move's startup animPtr
 *     (we'd be leaking into the next move), or
 *   - maxFrames is reached.
 *
 * The `otherStartups` set is the boundary guard: without it, walking
 * from c.jab (0x8F9B2) for 20 strides bleeds into c.strong (0x8FA2E)
 * and beyond, flattening the matrix into "all Ken normals have the
 * same range".
 */
function deriveTimeline(
  rom: Uint8Array,
  startupPtr: number,
  maxFrames: number,
  otherStartups: ReadonlySet<number>,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < maxFrames; i++) {
    const ptr = startupPtr + i * FRAME_STRIDE;
    if (i > 0 && otherStartups.has(ptr)) break;
    const atkId = readRomByte(rom, ptr + ATTACK_BOX_SPEC.idPtr);
    const headId = readRomByte(rom, ptr + HURT_SPECS[0]!.idPtr);
    const bodyId = readRomByte(rom, ptr + HURT_SPECS[1]!.idPtr);
    const legsId = readRomByte(rom, ptr + HURT_SPECS[2]!.idPtr);
    if (atkId === 0 && headId === 0 && bodyId === 0 && legsId === 0) break;
    out.push(ptr);
  }
  return out;
}

function collectKenStartups(): Set<number> {
  const s = new Set<number>();
  for (const tl of Object.values(KEN_MOVE_TIMELINES)) {
    if (tl && tl.length > 0) s.add(tl[0]!.animPtr);
  }
  return s;
}

function collectRyuStartups(): Set<number> {
  return new Set(Object.values(RYU_MOVE_STARTUPS));
}

/** Max hit distance at one (ken_frame, ryu_frame) pair, or -Infinity.
 *
 * Empirically validated formula: after resolveBoxFromRom applies signX,
 * `cx + halfW` encodes "distance from the character origin to the
 * forward edge of the box" — the sign convention is already aligned
 * between attacker and victim when both are resolved in their natural
 * in-game facings (Ken P2 face-LEFT, Ryu P1 face-RIGHT).
 *
 * Max hit distance centre-to-centre = (ken_cx + ken_halfW)
 *                                   + (ryu_cx + ryu_halfW).
 */
function hitDistForPair(
  ctx: Context,
  kenAnimPtr: number,
  ryuAnimPtr: number,
): { dist: number; hurtKind: HitboxRect['kind'] | null } {
  const atk = resolveBoxFromRom(
    ctx.rom, kenAnimPtr, ctx.kenHitboxPtr, 0, 0, true, ATTACK_BOX_SPEC,
  );
  if (!atk) return { dist: -Infinity, hurtKind: null };
  const kenReach = atk.cx + atk.halfW;

  let best = -Infinity;
  let bestKind: HitboxRect['kind'] | null = null;
  for (const spec of HURT_SPECS) {
    const hurt = resolveBoxFromRom(
      ctx.rom, ryuAnimPtr, ctx.ryuHitboxPtr, 0, 0, false, spec,
    );
    if (!hurt) continue;
    const vGap = Math.abs(atk.cy - hurt.cy) - (atk.halfH + hurt.halfH);
    if (vGap > 0) continue;
    const ryuExtent = hurt.cx + hurt.halfW;
    const maxDist = kenReach + ryuExtent;
    if (maxDist > best) {
      best = maxDist;
      bestKind = spec.kind;
    }
  }
  return { dist: best, hurtKind: bestKind };
}

/** Compute the full matrix. Call once when both hitboxPtrs are known. */
export function computeKenVsRyuMatrix(
  rom: Uint8Array,
  kenHitboxPtr: number,
  ryuHitboxPtr: number,
): KenRyuMatrix {
  const ctx: Context = { rom, kenHitboxPtr, ryuHitboxPtr };
  const matrix: KenRyuMatrix = {};
  const kenStartups = collectKenStartups();
  const ryuStartups = collectRyuStartups();

  for (const [kenMoveName, kenTimelineCalibrated] of Object.entries(KEN_MOVE_TIMELINES) as Array<[ActionId, MoveTimeline | undefined]>) {
    if (!kenTimelineCalibrated) continue;
    matrix[kenMoveName] = {};
    const kenAnchor = kenTimelineCalibrated[0]!.animPtr;
    const kenFrames = deriveTimeline(rom, kenAnchor, KEN_MAX_FRAMES, kenStartups);
    for (const [ryuMoveName, ryuStartup] of Object.entries(RYU_MOVE_STARTUPS)) {
      const ryuFrames = deriveTimeline(rom, ryuStartup, RYU_MAX_FRAMES, ryuStartups);
      let best: PairResult = { maxHitDist: -Infinity, kenFrame: -1, ryuFrame: -1, hurtKind: null };
      for (let i = 0; i < kenFrames.length; i++) {
        const kenPtr = kenFrames[i]!;
        for (let j = 0; j < ryuFrames.length; j++) {
          const { dist, hurtKind } = hitDistForPair(ctx, kenPtr, ryuFrames[j]!);
          if (dist > best.maxHitDist) {
            best = { maxHitDist: dist, kenFrame: i, ryuFrame: j, hurtKind };
          }
        }
      }
      matrix[kenMoveName]![ryuMoveName] = best;
    }
  }
  return matrix;
}

/**
 * Frame-by-frame detail dump for a specific (Ken move, Ryu move) pair.
 * Prints every Ken active frame × every Ryu frame with the raw ROM
 * values so we can verify the reach + extent model is computing the
 * right thing. Turn this on for "Ken c.LK vs Ryu sweep" when the
 * aggregate matrix looks suspicious.
 */
export function dumpPairDetail(
  rom: Uint8Array,
  kenHitboxPtr: number,
  ryuHitboxPtr: number,
  kenMoveName: ActionId,
  ryuMoveName: string,
): string {
  const kenCalibrated = KEN_MOVE_TIMELINES[kenMoveName];
  const ryuStartup = RYU_MOVE_STARTUPS[ryuMoveName];
  if (!kenCalibrated || ryuStartup === undefined) {
    return `[dumpPairDetail] unknown pair: ${kenMoveName} vs ${ryuMoveName}`;
  }
  const kenFrames = deriveTimeline(
    rom, kenCalibrated[0]!.animPtr, KEN_MAX_FRAMES, collectKenStartups(),
  );
  const ryuFrames = deriveTimeline(
    rom, ryuStartup, RYU_MAX_FRAMES, collectRyuStartups(),
  );
  const lines: string[] = [];
  lines.push(`\n== DETAIL: KEN ${kenMoveName} × RYU ${ryuMoveName} ==`);

  // --- Ken frames (stride-based, face LEFT) ---
  lines.push('-- Ken frames (stride scan, face LEFT, origin 0):');
  for (let i = 0; i < kenFrames.length; i++) {
    const ptr = kenFrames[i]!;
    const atkId = readRomByte(rom, ptr + ATTACK_BOX_SPEC.idPtr);
    const atk = resolveBoxFromRom(rom, ptr, kenHitboxPtr, 0, 0, true, ATTACK_BOX_SPEC);
    if (!atk) {
      lines.push(`  kenF${i} ptr=0x${ptr.toString(16).toUpperCase()} atkId=${atkId} — no attackbox`);
      continue;
    }
    const reach = atk.cx + atk.halfW;
    lines.push(
      `  kenF${i} ptr=0x${ptr.toString(16).toUpperCase()} atkId=${atkId}`
      + ` cx=${atk.cx} cy=${atk.cy} halfW=${atk.halfW} halfH=${atk.halfH}`
      + ` → reach=${reach}px`,
    );
  }

  // --- Ryu frames ---
  lines.push('-- Ryu hurtboxes (face RIGHT, origin 0):');
  for (let j = 0; j < ryuFrames.length; j++) {
    const ptr = ryuFrames[j]!;
    const parts: string[] = [`  ryuF${j} ptr=0x${ptr.toString(16).toUpperCase()}`];
    for (const spec of HURT_SPECS) {
      const hurt = resolveBoxFromRom(rom, ptr, ryuHitboxPtr, 0, 0, false, spec);
      if (!hurt) {
        parts.push(`${spec.kind}=·`);
        continue;
      }
      const extent = hurt.cx + hurt.halfW;
      parts.push(
        `${spec.kind}[cx=${hurt.cx} cy=${hurt.cy} hW=${hurt.halfW} hH=${hurt.halfH} ext=${extent}]`,
      );
    }
    lines.push(parts.join(' '));
  }

  // --- Best overlap per frame pair ---
  lines.push('-- Max hit distance per (kenF, ryuF) pair (only if vertical OK):');
  for (let i = 0; i < kenFrames.length; i++) {
    const atk = resolveBoxFromRom(
      rom, kenFrames[i]!, kenHitboxPtr, 0, 0, true, ATTACK_BOX_SPEC,
    );
    if (!atk) continue;
    const row: string[] = [`  kenF${i}:`];
    for (let j = 0; j < ryuFrames.length; j++) {
      let bestDist = -Infinity;
      let bestKind = '';
      for (const spec of HURT_SPECS) {
        const hurt = resolveBoxFromRom(
          rom, ryuFrames[j]!, ryuHitboxPtr, 0, 0, false, spec,
        );
        if (!hurt) continue;
        const vGap = Math.abs(atk.cy - hurt.cy) - (atk.halfH + hurt.halfH);
        if (vGap > 0) continue;
        const reach = atk.cx + atk.halfW;
        const extent = hurt.cx + hurt.halfW;
        const d = reach + extent;
        if (d > bestDist) { bestDist = d; bestKind = spec.kind; }
      }
      if (bestDist === -Infinity) {
        row.push(`ryuF${j}=·`);
      } else {
        row.push(`ryuF${j}=${bestDist.toFixed(0)}(${bestKind.replace('hurt_', '')})`);
      }
    }
    lines.push(row.join(' '));
  }
  return lines.join('\n');
}

/** Pretty-print the matrix as one table per Ken move. */
export function dumpMatrix(matrix: KenRyuMatrix): string {
  const lines: string[] = [];
  for (const [ken, row] of Object.entries(matrix)) {
    lines.push(`\n── KEN ${ken} ──`);
    const ryuEntries = Object.entries(row)
      .sort((a, b) => b[1].maxHitDist - a[1].maxHitDist);
    for (const [ryu, r] of ryuEntries) {
      if (r.maxHitDist <= 0) {
        lines.push(`  ${ryu.padEnd(22)} · no hit`);
        continue;
      }
      const dist = r.maxHitDist.toFixed(0).padStart(4);
      lines.push(
        `  ${ryu.padEnd(22)} max=${dist}px  kenFrame=${r.kenFrame}  ryuFrame=${r.ryuFrame}  kind=${r.hurtKind ?? '?'}`,
      );
    }
  }
  return lines.join('\n');
}
