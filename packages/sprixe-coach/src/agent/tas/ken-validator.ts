import type { GameState } from '../../types';
import { actionForAnimPtr } from './move-map';
import {
  resolveBoxFromRom,
  ATTACK_BOX_SPEC,
  readRomByte,
} from './box-predictor';
import { KEN_MOVE_TIMELINES, animPtrAtFrame } from './ken-move-timelines';

/**
 * Phase 1 gate: verify the ROM attack-box resolver matches the live
 * `p2.attackbox` on every Ken attack frame. Logs any mismatch >2px,
 * so a clean round prints nothing. Achieved 0/N on 2026-04-22 — the
 * resolver produces pixel-perfect attackboxes when fed the live
 * animPtr. Timeline-driven prediction (for Phase 2 forward sim) is
 * deferred pending accurate per-frame hold durations.
 *
 * Activate via the `?validate-ken=1` URL param. No runtime cost when
 * not enabled.
 */
const ATTACK_STATES = new Set([0x0A, 0x0C, 0x04]);

export class KenMoveValidator {
  private moveStartFrame = -1;
  private moveAnimPtrStart = 0;
  private prevP2State = 0x00;
  private prevStateEntryFrame = -1;
  /** animPtr captured the moment Ken entered the current attack state.
   *  Used by the hadouken fallback so the anchor is the state-entry
   *  animPtr, not the animPtr 20 frames later. */
  private stateEntryAnimPtr = 0;
  private mismatches = 0;
  private comparisons = 0;

  onFrame(state: GameState, rom: Uint8Array): void {
    const p2 = state.p2;
    const stateByte = p2.stateByte;
    const exited = !ATTACK_STATES.has(stateByte);
    this.prevP2State = stateByte;

    if (exited) {
      // Reset the anchor so the next move re-captures its own active frame.
      this.moveStartFrame = -1;
      this.prevStateEntryFrame = -1;
      this.stateEntryAnimPtr = 0;
      return;
    }
    // Anchor on the first frame where (a) Ken has a live attackbox
    // (active frame 0 — DP/Tatsu/normals), or (b) we've been in the
    // attack state long enough that no attackbox is expected on Ken
    // (hadouken — projectile owns the attackbox).
    if (this.moveStartFrame < 0) {
      if (p2.attackbox) {
        this.moveStartFrame = state.frameIdx;
        this.moveAnimPtrStart = p2.animPtr;
      } else if (this.prevStateEntryFrame < 0) {
        // First frame in attack state — remember both the frame and
        // the animPtr so the hadouken fallback anchors correctly later.
        this.prevStateEntryFrame = state.frameIdx;
        this.stateEntryAnimPtr = p2.animPtr;
      } else if (state.frameIdx - this.prevStateEntryFrame > 20) {
        // 20f passed since entering attack state with no attackbox on
        // Ken → assume projectile special (Hadouken). Anchor using the
        // STATE-ENTRY snapshot so frameOffset aligns with timelines
        // that start at the hadouken startup animPtr.
        this.moveStartFrame = this.prevStateEntryFrame;
        this.moveAnimPtrStart = this.stateEntryAnimPtr;
      }
    }
    if (this.moveStartFrame < 0) return;

    const action = actionForAnimPtr(p2.charId, this.moveAnimPtrStart);
    if (!action) return;  // unknown Ken move — can't validate

    const frameOffset = state.frameIdx - this.moveStartFrame;
    // Phase 1: resolve the attackbox from the LIVE animPtr instead of
    // walking the captured timeline. The recorded frame-hold durations
    // came out too short (extractor/vblank desync), making the walker
    // drift ahead of the game. For attackbox shape correctness we only
    // need the right animPtr, which p2 already hands us. Phase 2's
    // forward simulator will need accurate durations — handle there.
    const predicted = resolveBoxFromRom(
      rom,
      p2.animPtr,
      p2.hitboxPtr ?? 0,
      p2.x,
      p2.posY ?? 0,
      p2.facingLeft ?? false,
      ATTACK_BOX_SPEC,
    );
    const live = p2.attackbox ?? null;
    this.comparisons++;

    // Both null is a match (no attack this frame).
    if (predicted === null && live === null) return;
    if (predicted === null || live === null) {
      this.mismatches++;
      console.warn(
        `[validate:ken] ${action} f+${frameOffset}: predicted=${fmt(predicted)} live=${fmt(live)} ` +
        this.diagnose(action, frameOffset, p2),
      );
      return;
    }
    const dx = Math.abs(predicted.cx - live.cx);
    const dy = Math.abs(predicted.cy - live.cy);
    const dw = Math.abs(predicted.halfW - live.halfW);
    const dh = Math.abs(predicted.halfH - live.halfH);
    if (dx > 2 || dy > 2 || dw > 2 || dh > 2) {
      this.mismatches++;
      console.warn(
        `[validate:ken] ${action} f+${frameOffset}: Δcx=${dx} Δcy=${dy} Δw=${dw} Δh=${dh} ` +
        `predicted=${fmt(predicted)} live=${fmt(live)} ` +
        this.diagnose(action, frameOffset, p2, rom),
      );
    }
  }

  /**
   * Diagnostic dump emitted with every mismatch. Shows:
   * - `ptr_pred=XXX`: animPtr the timeline walker lands on at this offset
   * - `ptr_live=XXX`: animPtr the game actually holds right now
   * - `face=L|R`: current facingLeft
   * - `bytes=(vx,vy,rx,ry)`: the raw 4-byte attack box struct the
   *   predictor reads from ROM at ptr_pred (sanity check for resolver)
   *
   * Given these three numbers together, it's easy to tell WHY a frame
   * mismatches: timeline drift (ptr_pred != ptr_live), wrong box slot
   * (bytes inconsistent with predicted), or facing flip (sign of vx).
   */
  private diagnose(
    action: string,
    frameOffset: number,
    p2: GameState['p2'],
    rom?: Uint8Array,
  ): string {
    const timeline = KEN_MOVE_TIMELINES[action as never];
    const ptrPred = timeline ? animPtrAtFrame(timeline, frameOffset) : null;
    const ptrLive = p2.animPtr;
    const face = p2.facingLeft ? 'L' : 'R';
    const fmtPtr = (n: number | null) =>
      n === null ? 'null' : `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;
    let bytes = '';
    if (rom && ptrPred !== null && ptrPred !== 0) {
      const id = readRomByte(rom, ptrPred + ATTACK_BOX_SPEC.idPtr);
      bytes = ` idByte=${id}`;
    }
    return `[ptr_pred=${fmtPtr(ptrPred)} ptr_live=${fmtPtr(ptrLive)} face=${face}${bytes}]`;
  }

  summary(): string {
    return `[validate:ken] ${this.mismatches}/${this.comparisons} mismatches`;
  }

  reset(): void {
    this.moveStartFrame = -1;
    this.moveAnimPtrStart = 0;
    this.prevP2State = 0x00;
    this.prevStateEntryFrame = -1;
    this.stateEntryAnimPtr = 0;
    this.mismatches = 0;
    this.comparisons = 0;
  }
}

function fmt(r: { cx: number; cy: number; halfW: number; halfH: number } | null): string {
  if (r === null) return 'null';
  return `(${r.cx},${r.cy},±${r.halfW},±${r.halfH})`;
}
