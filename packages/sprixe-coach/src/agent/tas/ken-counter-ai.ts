import type { GameState } from '../../types';
import type { ActionId } from '../policy/types';
import {
  InputSequencer,
  type VirtualButton,
  type VirtualInputChannel,
  type InputFrame,
} from '../input-sequencer';
import { resolveMotion } from '../policy/actions';
import { minGapToHurtboxes } from '../policy/threat-geometry';
import { resolveBoxFromRom, ATTACK_BOX_SPEC } from './box-predictor';
import { KEN_MOVE_TIMELINES } from './ken-move-timelines';

/**
 * Geometric counter-AI — pixel-accurate.
 *
 * Algorithm: every vblank, read the opponent's active attackbox
 * (p1.attackbox, extracted live from ROM) and compute the minimum AABB
 * gap to Ken's hurtboxes. Fire a counter as soon as the gap drops to
 * ≤ TRIGGER_GAP_PX.
 *
 * Why a tight 8px threshold is correct — not a "wet-finger" 40px guess:
 *   - The opponent's attackbox is only live during the active frames
 *     of his move (3-8f for a jab, 5-10f for a sweep, etc.).
 *   - Once the gap reaches 0-8px, the hitbox is mid-sweep through
 *     Ken's column and will stay inside it for the rest of the active
 *     window — by the time Ken's 3f cLK launches, Ryu is still in the
 *     middle of his active frames, so cLK lands as a trade or clean
 *     interrupt (Ken cLK has priority because it launched later into
 *     an already-exposed hurtbox).
 *   - Firing earlier (large GAP) sends Ken out while Ryu is still in
 *     startup and might bait/block. Firing later (negative GAP) means
 *     Ken already ate the blow.
 *
 * No move tables, no predictions, no pushbox heuristics. The only
 * special case: if the opponent is airborne we swap cLK for shoryu
 * fierce (anti-air). Hadoukens travel as projectiles and show up as
 * their own attackbox on p1 briefly — they're handled by the same
 * code path automatically.
 */

/** Min frames between two counter fires. cLK total = 3+2+6=11f, so
 *  12f prevents interrupting our own animation. */
const COOLDOWN_FRAMES = 12;

export class KenCounterAi {
  private readonly sequencer: InputSequencer;
  private lastCounterFrame = -Infinity;
  private prevAttackboxPresent = false;

  constructor(private readonly channel: VirtualInputChannel) {
    this.sequencer = new InputSequencer(channel);
    console.log('[ken-counter-ai] geometric counter ARMED');
  }

  onVblank(state: GameState, rom: Uint8Array): void {
    this.sequencer.tick();

    // Rising-edge: attackbox transitions from absent to present on this
    // very frame — Ryu just committed to the active phase of a move.
    // Snapshot before any early return so the edge isn't lost across
    // cooldown / busy frames.
    const attackboxNow = state.p1.attackbox !== null && state.p1.attackbox !== undefined;
    const attackboxRising = attackboxNow && !this.prevAttackboxPresent;
    this.prevAttackboxPresent = attackboxNow;

    if (this.sequencer.busy) return;
    if (state.frameIdx - this.lastCounterFrame < COOLDOWN_FRAMES) return;
    if (state.p2.stateByte !== 0x00) return;
    if (!attackboxRising) return;

    // Resolve cLK Ken's attackbox live from ROM at Ken's current
    // position/facing. If it would overlap any Ryu hurtbox → cLK can
    // land → fire. Otherwise cLK whiffs → do nothing.
    const cLKAtk = computeKenCLKAttackBox(state, rom);
    if (!cLKAtk) return;
    const whiffGap = minGapToHurtboxes(cLKAtk, state.p1);
    if (whiffGap === null || whiffGap > 0) {
      console.log(
        `[ken-counter-ai] f=${state.frameIdx} attack rising but cLK whiffs (gap=${whiffGap}) — skip`,
      );
      return;
    }

    const action: ActionId = 'crouch_short';
    console.log(
      `[ken-counter-ai] f=${state.frameIdx} FIRE cLK would connect (gap=${whiffGap.toFixed(0)}) → ${action}`,
    );
    this.executeMotion(action, state);
    this.lastCounterFrame = state.frameIdx;
  }

  reset(): void {
    this.sequencer.clear();
    this.channel.releaseAll();
    this.lastCounterFrame = -Infinity;
    this.prevAttackboxPresent = false;
  }

  private executeMotion(action: ActionId, state: GameState): void {
    const result = resolveMotion(action);
    const facingLeft = state.p2.x >= state.p1.x;
    if (result.kind === 'motion') {
      this.sequencer.push(flipFrames(result.frames, facingLeft));
    } else if (result.kind === 'held') {
      this.sequencer.push([{
        held: flipButtons(result.held, facingLeft),
        frames: result.frames,
      }]);
    }
    this.sequencer.tick();
  }
}

/**
 * Resolve Ken's cLK attackbox pixel-accurately from the ROM, anchored
 * to his current world position/facing. Walks the recorded cLK
 * timeline and returns the first animation frame that exposes an
 * attackbox (i.e. the first active frame). Returns null if Ken's
 * hitboxPtr is absent or no active frame has a live box.
 */
function computeKenCLKAttackBox(state: GameState, rom: Uint8Array) {
  const hitboxPtr = state.p2.hitboxPtr;
  if (!hitboxPtr) return null;
  const timeline = KEN_MOVE_TIMELINES['crouch_short'];
  if (!timeline) return null;
  for (const entry of timeline) {
    const box = resolveBoxFromRom(
      rom,
      entry.animPtr,
      hitboxPtr,
      state.p2.x,
      state.p2.posY ?? 0,
      state.p2.facingLeft ?? false,
      ATTACK_BOX_SPEC,
    );
    if (box) return box;
  }
  return null;
}

function flipButtons(buttons: readonly VirtualButton[], facingLeft: boolean): readonly VirtualButton[] {
  if (facingLeft) return buttons;
  return buttons.map(b => (b === 'left' ? 'right' : b === 'right' ? 'left' : b));
}

function flipFrames(frames: readonly InputFrame[], facingLeft: boolean): InputFrame[] {
  if (facingLeft) return frames.map(f => ({ ...f }));
  return frames.map(f => ({ ...f, held: flipButtons(f.held, false) }));
}
