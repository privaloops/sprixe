import type { GameState } from '../../types';
import type { ActionId } from '../policy/types';
import {
  InputSequencer,
  type VirtualButton,
  type VirtualInputChannel,
  type InputFrame,
} from '../input-sequencer';
import { resolveMotion } from '../policy/actions';

/**
 * Ken move-map calibration harness.
 *
 * Enqueues each action from CALIBRATION_MOVES one at a time on P2, and
 * captures Ken's `animPtr` on the very frame `stateByte` leaves 0x00
 * (the move's first frame). Prints a ready-to-paste TypeScript snippet
 * once every move has been observed.
 *
 * Drive with AiFighter(calibrateKen: true). Requires a clean match in
 * progress — put training mode on, let the round start, and watch the
 * console.
 */

/** All Ken offensive moves for the Phase 1 catalog gate.
 *
 *  Order matters: cheap/reliable first (grounded normals), then specials,
 *  then jumps, then air tatsus. If something plants late everything
 *  before it is already captured.
 *
 *  Throws omitted — at calibration distance they whiff and come out as
 *  standing_fierce, which would duplicate an already-captured animPtr. */
export const CALIBRATION_MOVES: readonly ActionId[] = [
  // Crouch normals (6)
  'crouch_jab', 'crouch_strong', 'crouch_fierce',
  'crouch_short', 'crouch_mk', 'sweep',
  // Standing normals (6)
  'standing_jab', 'standing_strong', 'standing_fierce',
  'standing_short', 'standing_forward', 'standing_rh',
  // Ground specials (9)
  'hadouken_jab', 'hadouken_strong', 'hadouken_fierce',
  'shoryu_jab', 'shoryu_strong', 'shoryu_fierce',
  'tatsu_lk', 'tatsu_mk', 'tatsu_hk',
  // Forward jumps (6)
  'jump_forward_lp', 'jump_forward_mp', 'jump_forward_hp',
  'jump_forward_lk', 'jump_forward_mk', 'jump_forward_hk',
  // Neutral jumps (6)
  'jump_neutral_lp', 'jump_neutral_mp', 'jump_neutral_hp',
  'jump_neutral_lk', 'jump_neutral_mk', 'jump_neutral_hk',
  // Back jumps (6)
  'jump_back_lp', 'jump_back_mp', 'jump_back_hp',
  'jump_back_lk', 'jump_back_mk', 'jump_back_hk',
  // Air tatsus (3) — jump then qcb+K mid-air
  'air_tatsu_lk', 'air_tatsu_mk', 'air_tatsu_hk',
];

/** Frames to idle after the move finishes before launching the next one.
 *  Covers fierce Shoryuken's 34f recovery + a safety margin. */
const POST_MOVE_IDLE_FRAMES = 40;
/** Maximum frames to wait for a valid state transition after queuing a
 *  motion. Long enough to cover the whole motion + a full intro + the
 *  slowest startup (13f Hadouken jab), with a safety margin. */
const STATE_TRANSITION_TIMEOUT = 80;
/** Per-move retry cap. During the intro the first moves all timeout —
 *  we retry them quietly once inputs start registering. */
const MAX_RETRIES = 4;
/** State bytes that represent "Ken is actually doing the move":
 *   0x0A = normal attack active (standing/crouching normals)
 *   0x0C = special attack active (Hadouken / Shoryu / Tatsu)
 *   0x04 = airborne (jumps and jump-in attacks)
 *  0x02 = walking (charge phase of a motion) — must be IGNORED so we
 *  don't capture the walking animPtr on shoryu/tatsu/hadouken. */
const ACCEPTED_MOVE_STATES = new Set([0x0A, 0x0C, 0x04]);

type Phase =
  | { kind: 'waiting-idle' }          // wait for p2.stateByte = 0x00 before queuing next
  | { kind: 'queued'; startedFrame: number; retries: number }  // motion queued, waiting for state transition
  // provisional capture taken at state entry. We hold here for a short
  // window: if attackbox appears, upgrade the anchor to that frame
  // (active frame 0); otherwise keep the state-entry animPtr (the case
  // for projectiles like Hadouken where the attackbox lives on the
  // fireball entity, not on Ken).
  | { kind: 'observing'; entryFrame: number; entryAnimPtr: number; upgraded: boolean }
  | { kind: 'captured'; restStartFrame: number }; // move executing, let it finish

/** After state entry, frames we keep watching for an attackbox before
 *  committing the anchor. Covers the slowest startup we care about
 *  (Shoryuken fierce = 5f, Tatsu = 6f) with generous margin. */
const OBSERVE_WINDOW_FRAMES = 20;

export class KenCalibrationPilot {
  private readonly sequencer: InputSequencer;
  private readonly channel: VirtualInputChannel;
  private readonly moves: readonly ActionId[];
  private captured: Array<{ action: ActionId; animPtr: number; stateByte: number }> = [];
  private idx = 0;
  private phase: Phase = { kind: 'waiting-idle' };
  private frameCount = 0;
  private prevP2State = 0x00;
  private done = false;

  constructor(channel: VirtualInputChannel, moves: readonly ActionId[] = CALIBRATION_MOVES) {
    this.channel = channel;
    this.sequencer = new InputSequencer(channel);
    this.moves = moves;
    console.log(`[calibrate:ken] armed — will run ${this.moves.length} Ken moves`);
  }

  /** Current move the pilot is working on, or null when every move
   *  has been processed. Used by the trajectory-recording freezer to
   *  tweak Ken's anchor X per-move (back jumps need more right-wall
   *  margin). */
  currentMove(): ActionId | null {
    return this.moves[this.idx] ?? null;
  }

  onFrame(state: GameState): void {
    this.frameCount++;
    if (this.done) {
      this.sequencer.tick();
      return;
    }
    // Gate on fight phase — we need Ken actually controllable.
    if (state.roundPhase !== 'fight') {
      this.sequencer.clear();
      return;
    }

    const p2 = state.p2;
    const p2State = p2.stateByte;
    const justEnteredMoveState =
      !ACCEPTED_MOVE_STATES.has(this.prevP2State)
      && ACCEPTED_MOVE_STATES.has(p2State);
    const hasAttackbox = p2.attackbox !== null && p2.attackbox !== undefined;
    this.prevP2State = p2State;

    // If we drained the queue ahead of schedule (e.g. timeout), ensure
    // no phantom inputs linger.
    if (!this.sequencer.busy && this.phase.kind !== 'queued') {
      this.channel.releaseAll();
    }

    switch (this.phase.kind) {
      case 'waiting-idle': {
        if (p2State !== 0x00) return;  // still in prior move / hitstun
        this.queueCurrent(state, 0);
        break;
      }
      case 'queued': {
        // First wait for Ken to actually enter the move state. This
        // guards against the walking phase of DP/FB/Tatsu motions.
        if (justEnteredMoveState) {
          this.phase = {
            kind: 'observing',
            entryFrame: this.frameCount,
            entryAnimPtr: p2.animPtr,
            upgraded: false,
          };
        } else if (this.frameCount - this.phase.startedFrame > STATE_TRANSITION_TIMEOUT) {
          const action = this.moves[this.idx]!;
          const retries = this.phase.retries + 1;
          if (retries <= MAX_RETRIES) {
            console.warn(`[calibrate:ken]   timeout for ${action} — retry ${retries}/${MAX_RETRIES}`);
            this.sequencer.clear();
            // Stay on the same idx; re-queue once Ken is idle again.
            this.phase = { kind: 'waiting-idle' };
            // But also remember the retry count — we re-enter queued with it.
            this.pendingRetries = retries;
          } else {
            console.warn(`[calibrate:ken]   GIVE UP on ${action} after ${MAX_RETRIES} retries`);
            this.idx++;
            this.pendingRetries = 0;
            this.phase = { kind: 'waiting-idle' };
          }
        }
        break;
      }
      case 'observing': {
        // Upgrade anchor to the first frame with a live attackbox
        // (active frame 0). For fireballs the projectile owns the
        // attackbox, so Ken's attackbox stays null — we fall back to
        // the state-entry animPtr when the window elapses.
        if (!this.phase.upgraded && hasAttackbox && ACCEPTED_MOVE_STATES.has(p2State)) {
          this.phase.entryAnimPtr = p2.animPtr;
          this.phase.upgraded = true;
        }
        const windowElapsed = this.frameCount - this.phase.entryFrame >= OBSERVE_WINDOW_FRAMES;
        if (windowElapsed || !ACCEPTED_MOVE_STATES.has(p2State)) {
          const action = this.moves[this.idx]!;
          const animPtr = this.phase.entryAnimPtr;
          this.captured.push({ action, animPtr, stateByte: p2State });
          const ptrHex = `0x${animPtr.toString(16).toUpperCase().padStart(8, '0')}`;
          const suffix = this.phase.upgraded ? '(attackbox-anchored)' : '(state-entry, no attackbox on Ken)';
          console.log(`[calibrate:ken]   captured animPtr=${ptrHex} ${suffix}`);
          this.phase = { kind: 'captured', restStartFrame: this.frameCount };
        }
        break;
      }
      case 'captured': {
        // Let the move finish, then cool off.
        if (p2State === 0x00 && this.frameCount - this.phase.restStartFrame > POST_MOVE_IDLE_FRAMES) {
          this.idx++;
          this.pendingRetries = 0;
          this.phase = { kind: 'waiting-idle' };
        }
        break;
      }
    }

    this.sequencer.tick();
  }

  private pendingRetries = 0;

  private queueCurrent(state: GameState, _retriesSoFar: number): void {
    // Skip past any move already captured in an earlier round of this
    // session. The trajectory recorder stores its captures map under
    // `window.__kenTrajectories`, so multi-round calibration auto-resumes
    // without state-persistence plumbing. First round captures 10-15
    // moves, second round continues, etc.
    while (this.idx < this.moves.length && isAlreadyCaptured(this.moves[this.idx]!)) {
      console.log(`[calibrate:ken] skip ${this.moves[this.idx]} (already captured)`);
      this.idx++;
    }
    const action = this.moves[this.idx];
    if (action === undefined) { this.finish(); return; }
    const result = resolveMotion(action);
    if (result.kind === 'noop') {
      console.warn(`[calibrate:ken] noop for ${action} — skipping`);
      this.idx++;
      return;
    }
    const rawFrames: InputFrame[] = result.kind === 'motion'
      ? [...result.frames]
      : [{ held: result.held, frames: result.frames }];
    // Prepend a walk toward screen centre if Ken drifted to a corner.
    // Jumps (especially jump_back_*) push him to the edge; when he
    // hits the wall the trajectory recording gets clipped. A brief
    // walk first guarantees a clean capture anchor.
    const reposition = buildRecentreWalk(state.p2.x);
    const facingLeft = state.p2.x >= state.p1.x;
    const frames = flipFrames([...reposition, ...rawFrames], facingLeft);
    this.sequencer.clear();
    this.sequencer.push(frames);
    const retries = this.pendingRetries;
    this.phase = { kind: 'queued', startedFrame: this.frameCount, retries };
    if (retries === 0) {
      console.log(`[calibrate:ken] [${this.idx + 1}/${this.moves.length}] → ${action}`);
    }
  }

  reset(): void {
    this.sequencer.clear();
    this.channel.releaseAll();
    this.captured = [];
    this.idx = 0;
    this.phase = { kind: 'waiting-idle' };
    this.prevP2State = 0x00;
    this.pendingRetries = 0;
    this.done = false;
  }

  private finish(): void {
    this.done = true;
    this.sequencer.clear();
    console.log('[calibrate:ken] DONE — paste into ken-move-map.ts:');
    const seenPtr = new Map<number, string>();
    const lines: string[] = [];
    for (const { action, animPtr } of this.captured) {
      const hex = `0x${animPtr.toString(16).toUpperCase().padStart(8, '0')}`;
      const prior = seenPtr.get(animPtr);
      if (prior) {
        console.warn(`[calibrate:ken]   DUPLICATE animPtr ${hex}: ${prior} and ${action} share the same startup pointer`);
      }
      seenPtr.set(animPtr, action);
      lines.push(`  ${hex}: '${action}',`);
    }
    console.log(`export const KEN_ANIMPTR_TO_ACTION: Record<number, ActionId> = {\n${lines.join('\n')}\n};`);
  }
}

/**
 * When Ken is near a stage edge, build a pre-motion walk toward the
 * centre so the upcoming move captures its full natural trajectory
 * instead of getting clipped by the wall. Thresholds tuned against
 * observed SF2HF stage bounds (~100 to ~900 world X). Returns an
 * empty array when Ken is safely in the central band.
 *
 *  Ken P2 faces LEFT by default (Ryu on his left). In Ken's frame of
 *  reference, 'left' = forward and 'right' = backward. The absolute
 *  direction button we want depends on the screen side:
 *    - x < 200 (left corner)  → press 'right' to move screen-right
 *    - x > 800 (right corner) → press 'left'  to move screen-left
 *  flipFrames will mirror these if Ken's facing ever flips.
 */
function buildRecentreWalk(kenX: number): InputFrame[] {
  const LEFT_CORNER = 200;
  const RIGHT_CORNER = 800;
  const FRAMES = 40;
  if (kenX < LEFT_CORNER) return [{ held: ['right'], frames: FRAMES }];
  if (kenX > RIGHT_CORNER) return [{ held: ['left'], frames: FRAMES }];
  return [];
}

/**
 * Read the live trajectory-recorder captures via `window.__kenTrajectories`
 * if present. Returns true when `moveName` has already been captured in
 * this session, so the calibration pilot can skip past it instead of
 * re-running a move we already have data for. Safe on non-browser
 * environments (tests) — returns false.
 */
function isAlreadyCaptured(moveName: ActionId): boolean {
  if (typeof window === 'undefined') return false;
  const captures = (window as unknown as { __kenTrajectories?: Record<string, unknown> }).__kenTrajectories;
  return captures !== undefined && moveName in captures;
}

function flipButtons(buttons: readonly VirtualButton[], facingLeft: boolean): readonly VirtualButton[] {
  if (facingLeft) return buttons;
  return buttons.map((b) => (b === 'left' ? 'right' : b === 'right' ? 'left' : b));
}

function flipFrames(frames: readonly InputFrame[], facingLeft: boolean): InputFrame[] {
  if (facingLeft) return frames.map((f) => ({ ...f }));
  return frames.map((f) => ({ ...f, held: flipButtons(f.held, false) }));
}
