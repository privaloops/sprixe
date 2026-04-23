import type { ActionId } from '../policy/types';
import type { CharacterId } from '../../types';
import { getFrameData, type FrameData } from '../frame-data';
import { KEN_ANIMPTR_TO_ACTION } from './ken-move-map';

/**
 * animPtr (startup value) → ActionId — lets the tracker look up
 * frame data for P1's currently-executing move. Covers Ryu; Ken's
 * mapping pending character-specific calibration.
 */
const RYU_ANIMPTR_TO_ACTION: Record<number, ActionId> = {
  0x0005FBA2: 'standing_jab',
  0x0005FCCA: 'standing_strong',
  0x0005FDF2: 'standing_fierce',
  0x0005FF02: 'standing_short',
  0x00060012: 'standing_forward',
  0x00060122: 'standing_rh',
  0x000601B6: 'crouch_jab',
  0x0006043A: 'sweep',
  0x000607FE: 'jump_forward_lp',
  0x00060832: 'jump_forward_mp',
  0x000608DE: 'jump_forward_hp',
  0x00060CCE: 'hadouken_jab',
  0x00060D32: 'hadouken_strong',
  0x00060D96: 'hadouken_fierce',
  0x00060DFA: 'shoryu_jab',
  0x00060EA6: 'shoryu_strong',
  0x00060F52: 'shoryu_fierce',
  0x00060FFE: 'tatsu_mk',
};

const TABLES: Partial<Record<CharacterId, Record<number, ActionId>>> = {
  ryu: RYU_ANIMPTR_TO_ACTION,
  ken: KEN_ANIMPTR_TO_ACTION,
};

export function actionForAnimPtr(charId: CharacterId, animPtr: number): ActionId | null {
  return TABLES[charId]?.[animPtr] ?? null;
}

export function frameDataForAnimPtr(charId: CharacterId, animPtr: number): FrameData | null {
  const action = actionForAnimPtr(charId, animPtr);
  if (!action) return null;
  return getFrameData(action);
}

/**
 * Tracks the opponent's current move and computes the remaining
 * frames before they can act again. Deterministic: same (animPtr,
 * currentFrame) history → same counters.
 *
 * Strategy: we only recognize the STARTUP animPtr of a move (frame 1).
 * When animPtr transitions to a known startup value, we reset the
 * elapsed counter. Subsequent frames the animPtr advances by +0x18
 * per frame; we don't look it up — we just tick elapsed.
 *
 * When P1 returns to stateByte 0x00 (neutral), we clear the tracker.
 */
export class OpponentMoveTracker {
  private prevAnimPtr = 0;
  private startFrame = 0;
  private currentAction: ActionId | null = null;
  private currentCharId: CharacterId = 'unknown';

  update(charId: CharacterId, animPtr: number, stateByte: number, currentFrame: number): void {
    if (stateByte === 0x00) {
      this.currentAction = null;
      this.prevAnimPtr = animPtr;
      return;
    }
    const action = actionForAnimPtr(charId, animPtr);
    if (action && (animPtr !== this.prevAnimPtr || this.currentAction === null)) {
      this.currentAction = action;
      this.currentCharId = charId;
      this.startFrame = currentFrame;
    }
    this.prevAnimPtr = animPtr;
  }

  action(): ActionId | null {
    return this.currentAction;
  }

  /** Frames remaining until P1 can act again (end of recovery). 0 if unknown. */
  recoveryLeft(currentFrame: number): number {
    if (!this.currentAction) return 0;
    const fd = getFrameData(this.currentAction);
    if (!fd) return 0;
    const elapsed = currentFrame - this.startFrame;
    const total = fd.startup + fd.active + fd.recovery;
    return Math.max(0, total - elapsed);
  }

  /** Frames until the move's first active frame. 0 if already active / past. */
  startupLeft(currentFrame: number): number {
    if (!this.currentAction) return 0;
    const fd = getFrameData(this.currentAction);
    if (!fd) return 0;
    const elapsed = currentFrame - this.startFrame;
    return Math.max(0, fd.startup - elapsed);
  }

  /** Total duration of the current move (startup + active + recovery). */
  moveTotal(): number {
    if (!this.currentAction) return 0;
    const fd = getFrameData(this.currentAction);
    if (!fd) return 0;
    return fd.startup + fd.active + fd.recovery;
  }

  reset(): void {
    this.prevAnimPtr = 0;
    this.startFrame = 0;
    this.currentAction = null;
    this.currentCharId = 'unknown';
  }
}
