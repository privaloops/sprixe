import type { GameState, HitboxRect } from '../../types';
import { actionForAnimPtr } from './move-map';

/**
 * Record Ken's live trajectory + hitboxes frame-by-frame for each
 * attack he performs, so the punish engine can later simulate "where
 * will my attackbox be at frame N of this option, anchored at any
 * Ken position?" without re-observing.
 *
 * Usage (fully automated with `?record-trajectories=1`)
 * ──────────────────────────────────────────────────────
 *   The coach controller auto-arms KenCalibrationPilot alongside this
 *   recorder when the flag is set. Ken (P2) is then piloted through
 *   the full move list in sequence — you don't need to play anything.
 *
 *   After every completed move a partial `[record-traj]` JSON line
 *   is logged. Once every move has been captured, the recorder also
 *   dumps a single consolidated object between `[record-traj] BEGIN`
 *   and `[record-traj] END` markers and mirrors it at
 *   `window.__kenTrajectories` so you can `copy(window.__kenTrajectories)`
 *   in DevTools and paste into `ken-trajectories.json`.
 *
 * Why the captures live in JSON rather than code
 * ──────────────────────────────────────────────
 *   JSON is hot-editable: tweak a mis-recorded dx or trim the tail
 *   of an animation without recompiling. The engine loads the file
 *   at startup and caches the structure in memory.
 */

/** SF2HF state bytes that mean "Ken has committed to a move"
 *  (the same set the extractor uses elsewhere). Walking / idle
 *  aren't recorded; they carry no offensive value for the punish
 *  engine. */
const ATTACK_STATES: ReadonlySet<number> = new Set([0x0A, 0x0C, 0x04]);

interface BoxRel {
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
  kind: HitboxRect['kind'];
}

interface FrameSample {
  frame: number;
  dx: number;
  dy: number;
  attackbox: BoxRel | null;
  hurtboxes: BoxRel[];
  pushbox: BoxRel | null;
}

interface ActiveCapture {
  /** Null while we haven't seen a catalogued animPtr yet. SF2HF sets a
   *  transient pointer on the first frame of an attack state before
   *  settling on the real startup — we wait for that settled one
   *  (via `actionForAnimPtr`) before locking the move name. */
  moveName: string | null;
  animPtrStart: number;
  frameStart: number;
  anchorX: number;
  anchorY: number;
  samples: FrameSample[];
  prevAnimPtr: number;
  /** Facing at capture start. A side switch mid-capture (Ken crosses
   *  over Ryu during a jump) would flip every dx sign — the resulting
   *  trajectory would mix forward and back halves, unusable. */
  facingLeftAtStart: boolean;
  /** True if the capture has been poisoned: Ken got hit, changed side,
   *  or left the attack state via a non-natural path. The `flush` will
   *  refuse to store poisoned captures so the pilot retries next round. */
  poisoned: boolean;
  /** Reason tag for the poisoning, logged so the user knows why the
   *  move needs a retry. */
  poisonReason: string;
}

export class KenTrajectoryRecorder {
  private active: ActiveCapture | null = null;
  private prevState = 0x00;
  /** Accumulator keyed by move name. Latest capture wins if a move
   *  runs twice in a session. Exposed as `window.__kenTrajectories`
   *  so the user can `copy()` it from DevTools. */
  private readonly captures: Record<string, FrameSample[]> = {};
  /** Frame counter for the no-new-capture timeout. When the auto
   *  calibration pilot finishes, Ken stops making new moves — after
   *  a grace period we consider the session done and finalize. */
  private framesSinceLastCapture = 0;
  private finalized = false;

  constructor() {
    if (typeof window !== 'undefined') {
      (window as unknown as { __kenTrajectories?: Record<string, FrameSample[]> }).__kenTrajectories = this.captures;
    }
  }

  onFrame(state: GameState): void {
    // Only P2 is Ken in this harness (same convention as the rest of
    // the coach). If the round isn't in the fight phase we reset — no
    // point recording the intro pose loop.
    if (state.roundPhase !== 'fight') {
      this.prevState = 0x00;
      if (this.active) {
        // A move was mid-capture when the round ended — discard it,
        // the data would be incomplete.
        this.active = null;
      }
      return;
    }

    const ken = state.p2;
    const inAttack = ATTACK_STATES.has(ken.stateByte);
    const justEntered = inAttack && !ATTACK_STATES.has(this.prevState);
    const justExited = !inAttack && ATTACK_STATES.has(this.prevState);
    this.prevState = ken.stateByte;

    if (justEntered) {
      // Always start a capture on entry. The move name is resolved
      // lazily once SF2HF settles on a catalogued animPtr — first
      // frame is often a transient pointer.
      this.active = {
        moveName: actionForAnimPtr(ken.charId, ken.animPtr),
        animPtrStart: ken.animPtr,
        frameStart: state.frameIdx,
        anchorX: ken.x,
        anchorY: ken.posY ?? 0,
        samples: [],
        prevAnimPtr: ken.animPtr,
        facingLeftAtStart: ken.facingLeft ?? false,
        poisoned: false,
        poisonReason: '',
      };
    }

    // Mid-capture integrity checks. Poisoned captures are still marked
    // as active (to swallow the rest of the attack state frames) but
    // will be rejected at flush time.
    if (this.active && !this.active.poisoned) {
      if (ken.stateByte === 0x0E) {
        this.active.poisoned = true;
        this.active.poisonReason = 'ken got hit (hurt state)';
      } else if ((ken.facingLeft ?? false) !== this.active.facingLeftAtStart) {
        this.active.poisoned = true;
        this.active.poisonReason = 'side switch';
      }
    }

    if (this.active) {
      // If we don't yet have a move name, keep trying — the moment a
      // catalogued startup animPtr appears, lock the name and re-anchor
      // frame 0 / position to that moment (so frame 0 is the real
      // start of the catalogued move, not the transient frame before).
      if (this.active.moveName === null) {
        const name = actionForAnimPtr(ken.charId, ken.animPtr);
        if (name) {
          this.active.moveName = name;
          this.active.animPtrStart = ken.animPtr;
          this.active.frameStart = state.frameIdx;
          this.active.anchorX = ken.x;
          this.active.anchorY = ken.posY ?? 0;
          this.active.samples = [];
        }
      }
      // Only record samples once the name is pinned, otherwise we'd
      // be stuffing transient frames into the trajectory.
      if (this.active.moveName !== null) {
        this.active.samples.push(buildSample(state, this.active));
      }
      this.active.prevAnimPtr = ken.animPtr;
    }

    if (justExited && this.active) {
      if (this.active.poisoned) {
        console.log(
          `[record-traj] DROP ${this.active.moveName ?? '<unnamed>'} —`
          + ` ${this.active.poisonReason} (will retry next round)`,
        );
      } else if (this.active.moveName !== null && this.active.samples.length > 0) {
        this.flush(this.active);
      }
      this.active = null;
      this.framesSinceLastCapture = 0;
    } else if (!this.active) {
      this.framesSinceLastCapture++;
      // After ~5 seconds of no new capture AND at least one move
      // already captured, we consider the calibration done and
      // finalize. 300 frames at 60Hz ≈ 5s, well over POST_MOVE_IDLE
      // (40f) so the last move in the list has time to be captured
      // before we declare the session over.
      if (
        !this.finalized
        && Object.keys(this.captures).length > 0
        && this.framesSinceLastCapture > 300
      ) {
        this.finalize();
      }
    }
  }

  reset(): void {
    this.active = null;
    this.prevState = 0x00;
  }

  private flush(capture: ActiveCapture): void {
    // Guarded at the call site: only flush once moveName is pinned and
    // at least one sample recorded.
    if (capture.moveName === null) return;
    // Don't overwrite an existing capture. In SF2HF, jump_back_* and
    // jump_forward_* share the same animPtr (only Ken's x velocity
    // differs). The recorder resolves both to the forward name — if
    // we overwrote, we'd lose the forward trajectory in favour of the
    // back one. Back-direction trajectories are trivially reconstructed
    // at simulation time by mirroring dx (x velocity symmetric).
    if (this.captures[capture.moveName]) {
      console.log(`[record-traj] skip ${capture.moveName} — already captured, kept first trajectory`);
      return;
    }
    this.captures[capture.moveName] = capture.samples;
    console.log(
      `[record-traj] captured ${capture.moveName} — ${capture.samples.length} frames`
      + ` (total moves so far: ${Object.keys(this.captures).length})`,
    );
  }

  /** Dump the full consolidated JSON at the end of the calibration
   *  session. Surrounds with BEGIN/END markers so a grep of the
   *  console can extract the whole object. Idempotent — calling it
   *  again is a no-op. */
  finalize(): void {
    if (this.finalized) return;
    this.finalized = true;
    const header = `[record-traj] BEGIN (${Object.keys(this.captures).length} moves)`;
    const body = JSON.stringify(this.captures, null, 2);
    const footer = `[record-traj] END — also available at window.__kenTrajectories`;
    console.log(`${header}\n${body}\n${footer}`);
  }
}

function buildSample(state: GameState, capture: ActiveCapture): FrameSample {
  const ken = state.p2;
  const dx = ken.x - capture.anchorX;
  const dy = (ken.posY ?? 0) - capture.anchorY;
  return {
    frame: state.frameIdx - capture.frameStart,
    dx,
    dy,
    attackbox: ken.attackbox ? toRel(ken.attackbox, ken.x, ken.posY ?? 0) : null,
    hurtboxes: (ken.hurtboxes ?? []).map((h) => toRel(h, ken.x, ken.posY ?? 0)),
    pushbox: ken.pushbox ? toRel(ken.pushbox, ken.x, ken.posY ?? 0) : null,
  };
}

/**
 * Convert a world-space HitboxRect into an offset relative to the
 * character's current (x, y). The engine will re-project by adding
 * the anchor back in.
 */
function toRel(box: HitboxRect, charX: number, charY: number): BoxRel {
  return {
    cx: box.cx - charX,
    cy: box.cy - charY,
    halfW: box.halfW,
    halfH: box.halfH,
    kind: box.kind,
  };
}

function fmtBox(b: BoxRel): string {
  return `{"cx":${b.cx},"cy":${b.cy},"halfW":${b.halfW},"halfH":${b.halfH},"kind":"${b.kind}"}`;
}
