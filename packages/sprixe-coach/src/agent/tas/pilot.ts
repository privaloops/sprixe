import type { GameState } from '../../types';
import {
  InputSequencer,
  type VirtualButton,
  type VirtualInputChannel,
  type InputFrame,
} from '../input-sequencer';
import { resolveMotion } from '../policy/actions';
import { decideTas, applyCharacterFlavor, type TasContext } from './oracle';
import { resolveCombo } from './combos';
import { OpponentMoveTracker } from './move-map';

/** Frames the wakeup window stays open after 0x0E → ground transition.
 *  ~20f at 60Hz = ~330ms, covering both close meaties and far-range
 *  Hadoukens that travel ~60 frames to reach the recovery position. */
const WAKEUP_WINDOW_FRAMES = 20;

/** Frames a P1 projectile threat stays live after the special startup
 *  ends. Covers Hadouken fierce travel time at mid-to-full-screen. */
const FIREBALL_WINDOW_FRAMES = 35;

/**
 * TasPilot — drives P2 via the oracle. Runs the decision each frame
 * P2 is idle, queues the resolved motion through the sequencer, and
 * waits for it to drain before re-deciding.
 *
 * No tier rolls, no combos, no role resolver. One state → one action.
 */
export class TasPilot {
  private readonly sequencer: InputSequencer;
  private readonly channel: VirtualInputChannel;
  private readonly p1Tracker = new OpponentMoveTracker();
  private lastReason = '';
  private frameCount = 0;
  private prevP2State = 0x00;
  private wakeupEndFrame = -1;
  private prevP1State = 0x00;
  private fireballEndFrame = -1;
  private prevP1Threat = false;
  private prevFacingLeft: boolean | null = null;
  private prevP1Airborne = false;
  private p1LandingEndFrame = -1;

  constructor(channel: VirtualInputChannel) {
    this.channel = channel;
    this.sequencer = new InputSequencer(channel);
    console.log('[tas] pilot armed');
  }

  onFrame(state: GameState): void {
    this.frameCount++;
    // Update the P1 move tracker first — frame counters and ActionId lookup
    // driven off animPtr transitions. Must run before the oracle is called.
    this.p1Tracker.update(state.p1.charId, state.p1.animPtr, state.p1.stateByte, this.frameCount);

    // Wakeup detection: hurt state 0x0E → neutral 0x00 transition.
    if (this.prevP2State === 0x0E && state.p2.stateByte === 0x00) {
      this.wakeupEndFrame = this.frameCount + WAKEUP_WINDOW_FRAMES;
    }
    this.prevP2State = state.p2.stateByte;
    const wakeup = this.frameCount < this.wakeupEndFrame;

    // Fireball detection: the moment P1 ENTERS a special (0x0C) we arm
    // the defensive window. This mirrors Capcom's own AI which reacts
    // to the yoke on frame 1 — covering both startup (where Ken's DP
    // whiffs at mid range) and the projectile travel time after release.
    if (this.prevP1State !== 0x0C && state.p1.stateByte === 0x0C) {
      this.fireballEndFrame = this.frameCount + FIREBALL_WINDOW_FRAMES;
    }
    this.prevP1State = state.p1.stateByte;
    const fireballIncoming = this.frameCount < this.fireballEndFrame;

    // Landing window: P1 just transitioned from airborne to grounded.
    // For 15 frames we treat P1 as "just landed" — during this window
    // Ken must stay in block_stand instead of poking cMK (which would
    // whiff under P1's incoming jump-attack follow-up or landing recovery).
    if (this.prevP1Airborne && !state.p1.isAirborne) {
      this.p1LandingEndFrame = this.frameCount + 15;
    }
    this.prevP1Airborne = state.p1.isAirborne;
    const p1JustLanded = this.frameCount < this.p1LandingEndFrame;

    // Gate on round phase — don't burn inputs during intro / KO / outro.
    if (state.roundPhase !== 'fight') {
      if (this.sequencer.busy) this.sequencer.clear();
      this.lastReason = '';
      return;
    }

    // Interrupt on new threat: abort Ken's queue when P1 becomes a
    // fresh threat AND Ken is in a state that can start a new action.
    // Abortable states: 0x00 neutral, OR recovery of a prior normal
    // (yoke2 = 0x01 — inputs after recovery's end become live). During
    // an active attack (0x0A startup/active) or special (0x0C) we hold.
    const fireballJustArmed = this.frameCount === this.fireballEndFrame - FIREBALL_WINDOW_FRAMES + 1;
    const p1Threat = state.p1.attacking || state.p1.isAirborne;
    const p1JustThreatening = p1Threat && !this.prevP1Threat;
    this.prevP1Threat = p1Threat;
    // Side-switch: if P1 crossed over, the already-queued motion was
    // written for the OLD facing. Continuing would send wrong directions
    // and the game decodes random other specials (e.g. our DP turns into
    // Tatsumaki). Flush the queue so the next frame re-queues with the
    // new facing.
    const currentFacingLeft = state.p2.x >= state.p1.x;
    const sideSwitched = this.prevFacingLeft !== null && this.prevFacingLeft !== currentFacingLeft;
    this.prevFacingLeft = currentFacingLeft;

    const p2Abortable = state.p2.stateByte === 0x00 || state.p2.isRecovery;
    if (this.sequencer.busy && (sideSwitched || (p2Abortable && (fireballJustArmed || p1JustThreatening)))) {
      this.sequencer.clear();
    }

    // Drain the queue first. Only re-decide when it's empty AND Ken
    // is idle — skip decision during:
    //   0x0A normal attack (startup/active, inputs ignored by game)
    //   0x0C special attack (committed, no cancel)
    //   0x04 airborne jump (inputs drain uselessly mid-arc)
    if (this.sequencer.busy) {
      this.sequencer.tick();
      return;
    }
    if (state.p2.attacking
        || state.p2.stateByte === 0x0A
        || state.p2.stateByte === 0x0C
        || state.p2.stateByte === 0x04) {
      return;
    }

    const ctx: TasContext = {
      wakeup,
      fireballIncoming,
      p1Move: this.p1Tracker.action(),
      p1RecoveryLeft: this.p1Tracker.recoveryLeft(this.frameCount),
      p1StartupLeft: this.p1Tracker.startupLeft(this.frameCount),
      p1JustLanded,
    };
    const raw = decideTas(state, ctx);
    const decision = applyCharacterFlavor(raw, state.p2.charId);

    const label = decision.kind === 'action' ? decision.action : decision.combo;
    if (decision.reason !== this.lastReason) {
      console.log(`[tas] ${decision.reason} → ${label}`);
      this.lastReason = decision.reason;
    }

    let frames: InputFrame[];
    if (decision.kind === 'combo') {
      frames = [...resolveCombo(decision.combo)];
    } else {
      const result = resolveMotion(decision.action);
      if (result.kind === 'noop') return;
      frames = result.kind === 'motion'
        ? [...result.frames]
        : [{ held: result.held, frames: result.frames }];
    }
    const facingLeft = state.p2.x >= state.p1.x;
    this.sequencer.push(flipFrames(frames, facingLeft));
    this.sequencer.tick();
  }

  reset(): void {
    this.sequencer.clear();
    this.channel.releaseAll();
    this.p1Tracker.reset();
    this.lastReason = '';
    this.prevP2State = 0x00;
    this.wakeupEndFrame = -1;
    this.prevP1State = 0x00;
    this.fireballEndFrame = -1;
    this.prevP1Threat = false;
    this.prevFacingLeft = null;
    this.prevP1Airborne = false;
    this.p1LandingEndFrame = -1;
  }
}

function flipButtons(
  buttons: readonly VirtualButton[],
  facingLeft: boolean,
): readonly VirtualButton[] {
  if (facingLeft) return buttons;
  return buttons.map((b) => (b === 'left' ? 'right' : b === 'right' ? 'left' : b));
}

function flipFrames(
  frames: readonly InputFrame[],
  facingLeft: boolean,
): InputFrame[] {
  if (facingLeft) return frames.map((f) => ({ ...f }));
  return frames.map((f) => ({ ...f, held: flipButtons(f.held, false) }));
}
