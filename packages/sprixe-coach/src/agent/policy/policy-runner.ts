import type { GameState } from '../../types';
import { InputSequencer, type VirtualButton, type VirtualInputChannel, type InputFrame } from '../input-sequencer';
import type { Policy } from './types';
import {
  createConditionContext,
  updateConditionContext,
  type ConditionContext,
} from './conditions';
import { resolveMotion } from './actions';
import { TierRunner } from './tier-runner';
import type { CharacterMoveset } from '../characters/types';
import type { DifficultyLevel } from './difficulty';

/**
 * Top-level orchestrator. Each vblank:
 *   1. Update derived condition context.
 *   2. Handle interrupt (only when not mid-combo).
 *   3. Delegate decision to TierRunner (combo / optimal / passive / losing).
 *   4. Execute the chosen action via InputSequencer with facing flip.
 */
export class PolicyRunner {
  private policy: Policy;
  private readonly sequencer: InputSequencer;
  private readonly channel: VirtualInputChannel;
  private readonly ctx: ConditionContext;
  private tierRunner: TierRunner;
  private readonly level: DifficultyLevel;
  private frameIdx = 0;
  private lastDecisionLog = '';
  /** True while the sequencer is playing out a combo motion (no interrupts). */
  private inCombo = false;
  /** Debug: if set, Ken only repeats this action (bypasses tier logic). */
  private debugLoopAction: string | null = null;
  // Facing direction locked at the moment a motion is pushed. If P2
  // was on the RIGHT (facing LEFT = the default orientation for the
  // motion library), we push inputs unchanged. If P2 was on the LEFT
  // (facing RIGHT after a cross-up), we swap every 'left'↔'right'.
  private pushedFacing: 'left' | 'right' = 'left';

  constructor(
    channel: VirtualInputChannel,
    initialPolicy: Policy,
    moveset: CharacterMoveset,
    level: DifficultyLevel = 'normal',
  ) {
    this.channel = channel;
    this.sequencer = new InputSequencer(channel);
    this.policy = initialPolicy;
    this.ctx = createConditionContext();
    this.tierRunner = new TierRunner(moveset, level);
    this.level = level;
    console.log(`[ai-fighter] runner armed: ${moveset.displayName} @ ${level}`);
  }

  /** Swap moveset mid-game (e.g. character change on round reset). */
  setMoveset(moveset: CharacterMoveset): void {
    this.tierRunner = new TierRunner(moveset, this.level);
    console.log(`[ai-fighter] moveset swapped → ${moveset.displayName}`);
  }

  /** Debug: lock Ken on a single action loop. Set to null to restore policy. */
  setDebugLoopAction(action: string | null): void {
    this.debugLoopAction = action;
    console.log(`[ai-fighter] debug-loop = ${action ?? 'off'}`);
  }

  setPolicy(policy: Policy): void {
    this.policy = policy;
    console.log(`[ai-fighter] policy updated: ${policy.plan_tag ?? 'untagged'} (${policy.rules.length} rules, ${policy.combos?.length ?? 0} combos)`);
  }

  getPolicy(): Policy { return this.policy; }

  onVblank(state: GameState): void {
    this.frameIdx++;
    updateConditionContext(this.ctx, state, this.frameIdx);

    // INTERRUPT: urgent defense cuts a queued motion — except mid-combo,
    // which stays atomic (TAS-style: the script always plays out).
    const dist = Math.abs(state.p1.x - state.p2.x);
    const shouldInterrupt = !this.inCombo && this.sequencer.busy && (
      (state.p1.stateByte === 0x04 && dist < 180 && this.ctx.p1Dx > 0) ||
      (state.p1.attacking && dist < 140)
    );
    if (shouldInterrupt) {
      this.sequencer.clear();
      this.inCombo = false;
    }

    if (this.sequencer.busy) {
      this.sequencer.tick();
      return;
    }
    // Sequencer just drained — combo (if any) finished.
    this.inCombo = false;

    // CRITICAL: even when the input queue is empty, Ken can still be
    // mid-animation in game (moves take 15-50 game frames for startup
    // + active + recovery but our motion input only lasts ~4-12 frames).
    // Queuing a new action during this lockout makes the game ignore
    // the inputs — which is exactly what caused earlier "Ken fires
    // combos but hits almost nothing" regressions. Stall the decision
    // until P2 is actually idle again.
    if (state.p2.attacking || state.p2.stateByte === 0x0A || state.p2.stateByte === 0x0C) {
      return;
    }

    // Debug loop: if set, ignore all policy logic and repeat one action.
    // Used to verify the motion library + virtual input bridge end-to-end.
    if (this.debugLoopAction) {
      if (this.debugLoopAction !== this.lastDecisionLog) {
        console.log(`[ai-fighter] DEBUG-LOOP: ${this.debugLoopAction}`);
        this.lastDecisionLog = this.debugLoopAction;
      }
      this.execute(this.debugLoopAction, state);
      return;
    }

    const decision = this.tierRunner.decide(state, this.ctx, this.policy);
    if (!decision) {
      const fb = this.policy.fallback?.do;
      if (fb && typeof fb === 'string' && !fb.startsWith('role:')) {
        this.execute(fb, state);
      } else {
        this.channel.releaseAll();
      }
      return;
    }

    if (decision.ruleLogKey !== this.lastDecisionLog) {
      const comboTag = decision.comboName ? ` [${decision.comboName}]` : '';
      let label: string;
      if (decision.comboFrames) {
        const duration = decision.comboFrames.reduce((s, f) => s + (f.frames ?? 1), 0);
        label = `combo motion (${duration}f duration, ${decision.comboFrames.length} keyframes)`;
      } else {
        label = decision.action ?? '?';
      }
      console.log(`[ai-fighter] ${decision.tier}: ${label}${comboTag}`);
      this.lastDecisionLog = decision.ruleLogKey;
    }

    if (decision.comboFrames) {
      this.executeComboFrames(decision.comboFrames, state);
    } else if (decision.action) {
      this.execute(decision.action, state);
    }
  }

  private executeComboFrames(frames: InputFrame[], state: GameState): void {
    const facingLeft = state.p2.x >= state.p1.x;
    this.pushedFacing = facingLeft ? 'left' : 'right';
    this.sequencer.push(flipFrames(frames, facingLeft));
    this.inCombo = true;
    this.sequencer.tick();
  }

  reset(): void {
    this.sequencer.clear();
    this.channel.releaseAll();
    this.tierRunner.reset();
    this.inCombo = false;
    this.ctx.prevState = null;
    this.ctx.p1LastJumpFrame = null;
    this.ctx.p1LastSpecialFrame = null;
    this.ctx.p1LastNormalEndFrame = null;
    this.ctx.p1Dx = 0;
    this.ctx.p1JumpDrift = 0;
  }

  private execute(actionId: string, state: GameState): void {
    const result = resolveMotion(actionId as Parameters<typeof resolveMotion>[0]);
    const facingLeft = state.p2.x >= state.p1.x;
    this.pushedFacing = facingLeft ? 'left' : 'right';

    if (result.kind === 'motion') {
      this.sequencer.push(flipFrames(result.frames, facingLeft));
    } else if (result.kind === 'held') {
      this.sequencer.push([{ held: flipButtons(result.held, facingLeft), frames: result.frames }]);
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
