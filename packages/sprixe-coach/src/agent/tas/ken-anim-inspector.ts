import type { GameState } from '../../types';
import { actionForAnimPtr } from './move-map';

/**
 * Dev-only animPtr inspector for Phase 1 ROM investigation.
 *
 * When Ken enters an attack state (0x0A / 0x0C / 0x04), logs at every
 * vblank:
 *   [inspect:ken] <action> f+N animPtr=0xXXXX delta=+M bytes=[24 hex bytes]
 *
 * The goal: observe whether animPtr stays constant over multiple
 * vblanks (frame-hold timer), advances by variable increments
 * (next-ptr field), or something else entirely. Also dumps the raw
 * 24-byte frame struct so we can eyeball which offset encodes timing.
 *
 * Activate with `?inspect-ken=1`.
 */
const ATTACK_STATES = new Set([0x0A, 0x0C, 0x04]);

export class KenAnimInspector {
  private anchorPtr = 0;
  private anchorFrame = -1;
  private prevState = 0x00;
  private lastLoggedPtr = 0;

  onFrame(state: GameState, rom: Uint8Array): void {
    const p2 = state.p2;
    const stateByte = p2.stateByte;
    const inAttack = ATTACK_STATES.has(stateByte);
    const justExited = !inAttack && ATTACK_STATES.has(this.prevState);
    this.prevState = stateByte;

    if (justExited) {
      console.log('[inspect:ken] ── move ended ──');
      this.anchorFrame = -1;
      this.lastLoggedPtr = 0;
      return;
    }
    if (!inAttack) return;

    if (this.anchorFrame < 0) {
      this.anchorFrame = state.frameIdx;
      this.anchorPtr = p2.animPtr;
    }

    const frameOffset = state.frameIdx - this.anchorFrame;
    const delta = p2.animPtr - this.anchorPtr;
    const action = actionForAnimPtr(p2.charId, this.anchorPtr);
    const label = action ?? `anchor=0x${this.anchorPtr.toString(16).toUpperCase()}`;
    const ptrHex = `0x${p2.animPtr.toString(16).toUpperCase().padStart(8, '0')}`;
    const deltaStr = delta >= 0 ? `+0x${delta.toString(16).toUpperCase()}` : `-0x${(-delta).toString(16).toUpperCase()}`;

    // Log every frame (to see hold windows), but tag when the ptr
    // actually advances vs stays put.
    const advanced = p2.animPtr !== this.lastLoggedPtr;
    const tag = advanced ? '[ADVANCE]' : '[hold]';
    this.lastLoggedPtr = p2.animPtr;

    const bytes: string[] = [];
    const base = p2.animPtr & 0xFFFFFF;
    for (let i = 0; i < 0x18; i++) {
      bytes.push((rom[base + i] ?? 0).toString(16).padStart(2, '0'));
    }
    console.log(`[inspect:ken] ${label} f+${frameOffset} ${tag} animPtr=${ptrHex} delta=${deltaStr} bytes=[${bytes.join(' ')}]`);
  }

  reset(): void {
    this.anchorPtr = 0;
    this.anchorFrame = -1;
    this.prevState = 0x00;
    this.lastLoggedPtr = 0;
  }
}
