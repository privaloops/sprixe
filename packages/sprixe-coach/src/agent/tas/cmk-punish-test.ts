import type { GameState } from '../../types';
import type { VirtualInputChannel } from '../input-sequencer';

/**
 * Isolated feasibility test — can the stack react frame-perfectly?
 *
 * Protocol:
 *   1. Watch P1.animPtr each vblank.
 *   2. On the rising edge into Ryu's sweep (0x0006043A, recovery 24f),
 *      fire a Ken c.HP (startup 5f, crouching fierce) on the SAME frame.
 *   3. Log every relevant frame: press, Ken's own attackbox appearing,
 *      Ken's animPtr reaching c.HP, and any Ryu HP drop.
 *
 * Why c.HP as the response:
 *   Ryu sweep recovers in 24f. Ken c.HP has 5f startup + 8f active = hit
 *   lands by frame 13. Margin of 11 frames. If this doesn't connect,
 *   the stack has a fundamental latency or input-bridge problem.
 *
 * When this flag is on, the normal AI fighter is bypassed — this
 * harness owns P2's input channel for the duration of the test window.
 */
const RYU_SWEEP_PTR = 0x0006043A;
const KEN_CLK_PTR   = 0x0008FB3E;

export class CMKPunishTest {
  private prevP1Ptr = 0;
  private prevP1Hp: number | null = null;
  private prevP2AttackActive = false;
  private armedAtFrame: number | null = null;
  private pressLoggedChp = false;
  private pressLoggedAttack = false;
  private pressLoggedHit = false;
  private triggerCount = 0;

  constructor(private readonly channel: VirtualInputChannel) {}

  onVblank(state: GameState): void {
    const p1Ptr = state.p1.animPtr;
    const prevPtr = this.prevP1Ptr;
    this.prevP1Ptr = p1Ptr;

    // ── Trigger on the rising edge into Ryu sweep ──
    if (prevPtr !== RYU_SWEEP_PTR && p1Ptr === RYU_SWEEP_PTR) {
      this.triggerCount++;
      const dist = Math.abs(state.p1.x - state.p2.x);
      console.log(
        `[cmk-test] #${this.triggerCount} f=${state.frameIdx} RYU SWEEP DETECTED`
        + ` dist=${dist}px p2.state=0x${state.p2.stateByte.toString(16)}`
        + ` p2.attacking=${state.p2.attacking}`,
      );
      // Press Ken c.LK the SAME frame. Down + LK (button4), single frame.
      this.channel.setHeld(['down', 'button4']);
      this.armedAtFrame = state.frameIdx;
      this.prevP1Hp = state.p1.hp;
      this.pressLoggedChp = false;
      this.pressLoggedAttack = false;
      this.pressLoggedHit = false;
    }

    // Release input 1 frame after press (c.HP is a tap).
    if (this.armedAtFrame !== null && state.frameIdx - this.armedAtFrame === 1) {
      this.channel.setHeld([]);
    }

    // ── Log first frame where Ken's animPtr reaches c.LK startup ──
    if (this.armedAtFrame !== null && !this.pressLoggedChp
        && state.p2.animPtr === KEN_CLK_PTR) {
      const elapsed = state.frameIdx - this.armedAtFrame;
      console.log(`[cmk-test] +${elapsed}f Ken animPtr reached c.LK (input → game accepted)`);
      this.pressLoggedChp = true;
    }

    // ── Log the first frame Ken's attackbox goes active ──
    const p2AtkActive = state.p2.attackbox !== null && state.p2.attackbox !== undefined;
    if (this.armedAtFrame !== null && p2AtkActive && !this.pressLoggedAttack) {
      const elapsed = state.frameIdx - this.armedAtFrame;
      const ab = state.p2.attackbox!;
      console.log(
        `[cmk-test] +${elapsed}f Ken attackbox ACTIVE`
        + ` p2.state=0x${state.p2.stateByte.toString(16)}`
        + ` p2.animPtr=0x${state.p2.animPtr.toString(16).toUpperCase()}`
        + ` cx=${ab.cx} cy=${ab.cy}`,
      );
      this.pressLoggedAttack = true;
    }
    this.prevP2AttackActive = p2AtkActive;

    // ── Log Ryu HP drop (hit confirmed) ──
    if (this.armedAtFrame !== null && this.prevP1Hp !== null && !this.pressLoggedHit) {
      if (state.p1.hp < this.prevP1Hp) {
        const elapsed = state.frameIdx - this.armedAtFrame;
        console.log(
          `[cmk-test] +${elapsed}f HIT CONFIRMED — Ryu HP ${this.prevP1Hp} → ${state.p1.hp}`,
        );
        this.pressLoggedHit = true;
      }
    }

    // ── Log outcome at t+60 and disarm ──
    if (this.armedAtFrame !== null && state.frameIdx - this.armedAtFrame >= 60) {
      if (!this.pressLoggedHit) {
        console.log(
          `[cmk-test] +60f NO HIT — Ryu HP unchanged at ${state.p1.hp}`
          + ` p1.state=0x${state.p1.stateByte.toString(16)}`
          + ` p2.state=0x${state.p2.stateByte.toString(16)}`,
        );
      }
      this.armedAtFrame = null;
      this.prevP1Hp = null;
    }
  }

  reset(): void {
    this.channel.releaseAll();
    this.armedAtFrame = null;
    this.prevP1Hp = null;
    this.prevP1Ptr = 0;
  }
}
