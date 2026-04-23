import type { GameState } from '../../types';
import { actionForAnimPtr } from './move-map';

/**
 * Phase 1 pivot — empirical move timeline recorder.
 *
 * For each Ken attack a complete (animPtr, holdFrames)[] sequence is
 * captured and, when the move ends, printed as a ready-to-paste TS
 * literal for ken-move-timelines.ts.
 *
 * This replaces the failed ROM-walking approach (`animPtr += 0x18*N`
 * does NOT match the real animation — ROM frames are held for move-
 * specific vblank counts encoded outside the frame struct).
 *
 * Activate with `?record-ken=1`.
 */
const ATTACK_STATES = new Set([0x0A, 0x0C, 0x04]);

interface TimelineEntry { animPtr: number; frames: number; }

export class KenTimelineRecorder {
  private timeline: TimelineEntry[] = [];
  private currentPtr = 0;
  private currentHold = 0;
  private prevState = 0x00;
  private anchorAction: string | null = null;

  onFrame(state: GameState): void {
    const p2 = state.p2;
    const stateByte = p2.stateByte;
    const inAttack = ATTACK_STATES.has(stateByte);
    const justExited = !inAttack && ATTACK_STATES.has(this.prevState);
    this.prevState = stateByte;

    if (justExited) {
      this.flush();
      return;
    }
    if (!inAttack) return;

    if (this.timeline.length === 0 && this.currentHold === 0) {
      // Move just started.
      this.anchorAction = actionForAnimPtr(p2.charId, p2.animPtr);
      this.currentPtr = p2.animPtr;
      this.currentHold = 1;
      return;
    }
    if (p2.animPtr === this.currentPtr) {
      this.currentHold++;
    } else {
      // animPtr advanced — commit the current entry, start the new one.
      this.timeline.push({ animPtr: this.currentPtr, frames: this.currentHold });
      this.currentPtr = p2.animPtr;
      this.currentHold = 1;
    }
  }

  private flush(): void {
    if (this.currentHold > 0) {
      this.timeline.push({ animPtr: this.currentPtr, frames: this.currentHold });
    }
    const anchorPtr = this.timeline[0]?.animPtr ?? 0;
    const label = this.anchorAction ?? `unknown_0x${anchorPtr.toString(16).toUpperCase()}`;
    // Every line is prefixed with [record:ken] so DevTools filters on
    // that tag keep the whole snippet instead of hiding body lines.
    const total = this.timeline.reduce((acc, e) => acc + e.frames, 0);
    const lines = [
      `[record:ken] ${label} (${total} total frames across ${this.timeline.length} anim frames):`,
      `[record:ken]   ${label}: [`,
      ...this.timeline.map(
        (e) => `[record:ken]     { animPtr: 0x${e.animPtr.toString(16).toUpperCase().padStart(8, '0')}, frames: ${e.frames} },`,
      ),
      `[record:ken]   ],`,
    ];
    console.log(lines.join('\n'));
    this.timeline = [];
    this.currentPtr = 0;
    this.currentHold = 0;
    this.anchorAction = null;
  }

  reset(): void {
    this.timeline = [];
    this.currentPtr = 0;
    this.currentHold = 0;
    this.prevState = 0x00;
    this.anchorAction = null;
  }
}
