/**
 * Project the user's captured mapping (or the engine defaults) onto a
 * keyboard→NavAction map that drives the frontend menu. Both players
 * contribute: if P1 has up=ArrowUp and P2 has up=KeyI, both keys nav
 * up in the menu. This way the kiosk is controllable from either
 * seat, whatever device each player picked.
 *
 * Conflicts resolve in favour of the first occupant (P1 wins).
 */

import type { NavAction } from "./gamepad-nav";
import type { InputMapping, MappingRole, PlayerIndex } from "./mapping-store";
import { loadPlayerAssignment } from "./player-assignments";
import {
  DEFAULT_P1_MAPPING,
  DEFAULT_P2_MAPPING,
  type KeyMapping,
} from "@sprixe/engine/input/input";

/** Arcade role → menu action mapping. Same derivation as GamepadNav. */
const ROLE_TO_ACTION: Partial<Record<MappingRole, NavAction>> = {
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  button1: "confirm",
  button2: "back",
  button3: "context-menu",
  button5: "bumper-left",
  button6: "bumper-right",
  start: "start",
  coin: "coin-hold",
};

/**
 * Build the keyboard → NavAction map for the whole menu. Iterates P1
 * then P2 so P1's bindings win on conflict. Pulls custom key bindings
 * from the saved mapping first, else falls back to the engine's
 * default keyboard map — but only when the player has explicitly
 * picked "keyboard" as their device, so a gamepad-only setup doesn't
 * leak the arcade keys into the menu.
 */
export function computeKeyboardNavBindings(
  mapping: InputMapping | null,
): Map<string, NavAction> {
  const out = new Map<string, NavAction>();
  for (const player of [0, 1] as const) {
    const slot = keyboardSlot(player, mapping);
    if (!slot) continue;
    for (const [role, action] of Object.entries(ROLE_TO_ACTION) as [MappingRole, NavAction][]) {
      const code = slot[role];
      if (!code) continue;
      if (!out.has(code)) out.set(code, action);
    }
  }
  return out;
}

/**
 * Resolve the keyboard slot for a player:
 *  - Custom mapping with at least one `key` binding → project those.
 *  - Otherwise, defaults only when the player actually picked keyboard.
 */
function keyboardSlot(
  player: PlayerIndex,
  mapping: InputMapping | null,
): Partial<Record<MappingRole, string>> | null {
  const custom = player === 0 ? mapping?.p1 : mapping?.p2;
  if (custom) {
    const keys: Partial<Record<MappingRole, string>> = {};
    let any = false;
    for (const [role, binding] of Object.entries(custom) as [MappingRole, { kind: string; code?: string } | undefined][]) {
      if (binding?.kind === "key" && typeof binding.code === "string") {
        keys[role] = binding.code;
        any = true;
      }
    }
    if (any) return keys;
  }
  const assignment = loadPlayerAssignment(player);
  if (assignment.kind !== "keyboard") return null;
  return keyMappingToSlot(player === 0 ? DEFAULT_P1_MAPPING : DEFAULT_P2_MAPPING);
}

function keyMappingToSlot(m: KeyMapping): Partial<Record<MappingRole, string>> {
  return {
    up: m.up,
    down: m.down,
    left: m.left,
    right: m.right,
    button1: m.button1,
    button2: m.button2,
    button3: m.button3,
    button4: m.button4,
    button5: m.button5,
    button6: m.button6,
    start: m.start,
    coin: m.coin,
  };
}
