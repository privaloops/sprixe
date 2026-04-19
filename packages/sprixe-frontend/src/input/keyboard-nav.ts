/**
 * KeyboardNav — menu navigation driven by the keyboard.
 *
 * Listens for keydown/keyup on the window and emits the same NavAction
 * stream as GamepadNav. Which physical keys drive which action comes
 * from `computeKeyboardNavBindings`, which projects the user's saved
 * mapping (P1 + P2) onto the menu surface so either player can drive
 * the kiosk with their own keys.
 *
 * Repeats (up/down/left/right) piggy-back on the browser's native
 * key-repeat via KeyboardEvent.repeat. coin-hold is tracked with a
 * timeout from first keydown.
 */

import type { NavAction } from "./gamepad-nav";

const COIN_HOLD_MS = 1000;
const REPEATABLE: ReadonlySet<NavAction> = new Set(["up", "down", "left", "right"]);

type Listener = (action: NavAction) => void;

export class KeyboardNav {
  private codeToAction: Map<string, NavAction>;
  private readonly listeners = new Set<Listener>();
  private readonly pressed = new Set<string>();
  private coinHoldCode: string | null = null;
  private coinHoldTimer: number | null = null;
  private coinHoldFired = false;
  private running = false;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const action = this.codeToAction.get(e.code);
    if (!action) return;
    // Don't swallow system shortcuts (Cmd/Ctrl combos).
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (action === "coin-hold") {
      // Hold detection: start a timer on first press, fire once when
      // the user keeps the key down long enough. Regular keydown
      // doesn't emit — we preserve the "insert coin" semantics for
      // the engine if the player just taps.
      if (e.repeat) return;
      if (this.coinHoldCode === e.code) return;
      this.coinHoldCode = e.code;
      this.coinHoldFired = false;
      this.coinHoldTimer = window.setTimeout(() => {
        if (this.coinHoldCode === e.code) {
          this.coinHoldFired = true;
          this.emit("coin-hold");
        }
      }, COIN_HOLD_MS);
      return;
    }

    if (e.repeat) {
      if (!REPEATABLE.has(action)) return;
      this.emit(action);
      return;
    }

    this.pressed.add(e.code);
    this.emit(action);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.pressed.delete(e.code);
    if (this.coinHoldCode === e.code) {
      this.clearCoinHold();
    }
  };

  private readonly onBlur = (): void => {
    this.pressed.clear();
    this.clearCoinHold();
  };

  constructor(bindings: Map<string, NavAction>) {
    this.codeToAction = new Map(bindings);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.pressed.clear();
    this.clearCoinHold();
  }

  onAction(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  /** Replace the active bindings without tearing down the listeners. */
  setBindings(bindings: Map<string, NavAction>): void {
    this.codeToAction = new Map(bindings);
  }

  private emit(action: NavAction): void {
    for (const l of this.listeners) l(action);
  }

  private clearCoinHold(): void {
    if (this.coinHoldTimer !== null) {
      window.clearTimeout(this.coinHoldTimer);
      this.coinHoldTimer = null;
    }
    this.coinHoldCode = null;
    this.coinHoldFired = false;
  }
}
