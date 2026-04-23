import type { GameState } from '../../types';
import type { ActionId } from '../policy/types';
import {
  InputSequencer,
  type VirtualButton,
  type VirtualInputChannel,
  type InputFrame,
} from '../input-sequencer';
import { resolveMotion } from '../policy/actions';
import { actionForAnimPtr } from './move-map';
import { pickPunish } from './punish-engine';
import type { KenSnapshot, OpponentSnapshot } from './punish-sim';

/**
 * Ken counter-AI — reactive defence wired to the pure punish engine.
 *
 * Trigger: rising edge on the opponent entering an attack state
 * (0x0A normal / 0x0C special). On the first frame of the opponent's
 * committed move, we snapshot his animPtr + position and call
 * `pickPunish` to get the damage-optimal response. The chosen action
 * is pushed to the virtual P2 channel via the input sequencer.
 *
 * If `pickPunish` returns null (no viable option in the hierarchy
 * survives the simulator), we fall back to `block_crouch` — safest
 * default that covers low + mid attacks.
 *
 * All logic is in the pure engine + simulator; this class only
 * orchestrates timing (cooldown, state gates) and input execution.
 */

/** Minimum frames between two counter fires. Covers the duration of
 *  Ken's longest immediate response (shoryu_fierce = 46f total) so we
 *  don't spam inputs while the previous attack is still animating. */
const COOLDOWN_FRAMES = 18;

/** Opponent state bytes that mean "committed to a move we can punish". */
const OPPONENT_ATTACK_STATES: ReadonlySet<number> = new Set([0x0A, 0x0C]);

export class KenCounterAi {
  private readonly sequencer: InputSequencer;
  private lastCounterFrame = -Infinity;
  private prevOpponentAttacking = false;

  constructor(private readonly channel: VirtualInputChannel) {
    this.sequencer = new InputSequencer(channel);
    console.log('[ken-counter-ai] armed — pure pickPunish engine');
  }

  onVblank(state: GameState, rom: Uint8Array): void {
    this.sequencer.tick();

    // Rising-edge on opponent entering an attack state. We snapshot
    // before the gates below so the edge isn't lost across cooldown /
    // sequencer-busy frames.
    const oppAttackingNow = OPPONENT_ATTACK_STATES.has(state.p1.stateByte);
    const oppAttackingRising = oppAttackingNow && !this.prevOpponentAttacking;
    this.prevOpponentAttacking = oppAttackingNow;

    if (this.sequencer.busy) return;
    if (state.frameIdx - this.lastCounterFrame < COOLDOWN_FRAMES) return;
    if (state.p2.stateByte !== 0x00) return;
    if (!oppAttackingRising) return;

    // Resolve the opponent's move name from its startup animPtr. At
    // the very first frame of the attack state the animPtr may still
    // be transient — in that case we bail and wait for the next edge
    // (the engine is called often enough that a 1-frame miss is fine).
    const moveName = actionForAnimPtr(state.p1.charId, state.p1.animPtr);
    if (!moveName) {
      return;
    }

    const opponent: OpponentSnapshot = {
      x: state.p1.x,
      y: state.p1.posY ?? 0,
      facingLeft: state.p1.facingLeft ?? false,
      animPtrAtMoveStart: state.p1.animPtr,
      framesSinceMoveStart: 0,
      moveName,
      hitboxPtr: state.p1.hitboxPtr ?? 0,
    };
    const ken: KenSnapshot = {
      x: state.p2.x,
      y: state.p2.posY ?? 0,
      facingLeft: state.p2.facingLeft ?? false,
      hp: state.p2.hp,
    };

    const decision = pickPunish(opponent, ken, rom);
    if (!decision) {
      console.log(
        `[ken-counter-ai] f=${state.frameIdx} vs ${moveName} — empty candidate pool, block fallback`,
      );
      this.executeMotion('block_crouch', state);
      this.lastCounterFrame = state.frameIdx;
      return;
    }

    const action = decision.option.sequence[0]!;
    console.log(
      `[ken-counter-ai] f=${state.frameIdx} vs ${moveName}`
      + ` → ${decision.option.id} (${action}, deltaHp=${decision.deltaHp > 0 ? '+' : ''}${decision.deltaHp},`
      + ` dmg=${decision.option.damage}, taken=${decision.simResult.kenDamageTaken})`,
    );
    this.executeMotion(action, state);
    this.lastCounterFrame = state.frameIdx;
  }

  reset(): void {
    this.sequencer.clear();
    this.channel.releaseAll();
    this.lastCounterFrame = -Infinity;
    this.prevOpponentAttacking = false;
  }

  /** True when the counter-AI pushed an action during the given frame.
   *  Used by the coach controller to arbitrate with the offence LLM:
   *  both modules share the same virtual-P2 channel, so the LLM must
   *  yield the frame when the counter just wrote to it. */
  firedOnFrame(frameIdx: number): boolean {
    return this.lastCounterFrame === frameIdx;
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

function flipButtons(buttons: readonly VirtualButton[], facingLeft: boolean): readonly VirtualButton[] {
  if (facingLeft) return buttons;
  return buttons.map(b => (b === 'left' ? 'right' : b === 'right' ? 'left' : b));
}

function flipFrames(frames: readonly InputFrame[], facingLeft: boolean): InputFrame[] {
  if (facingLeft) return frames.map(f => ({ ...f }));
  return frames.map(f => ({ ...f, held: flipButtons(f.held, false) }));
}
