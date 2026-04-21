import type { GameState } from '../../types';
import type { InputFrame } from '../input-sequencer';
import type { CharacterMoveset } from '../characters/types';
import type { ActionId, ComboScript, ComboStep } from './types';
import { resolveAction } from './resolvers';
import { resolveMotion, type ActionResult } from './actions';
import { getFrameData, computeLinkWindow } from '../frame-data';

/**
 * Strip trailing release frames (held=[]) from a motion. When combos
 * chain cancel-to-cancel, the "release buffer" at the tail of a motion
 * inserts a neutral gap that breaks links. Removing them makes the
 * next motion start immediately.
 */
function stripTrailingRelease(frames: readonly InputFrame[]): InputFrame[] {
  const out = [...frames];
  while (out.length > 0 && out[out.length - 1]!.held.length === 0) {
    out.pop();
  }
  return out;
}

function insertNeutralGap(target: InputFrame[], gap: number): void {
  if (gap <= 0) return;
  target.push({ held: [], frames: gap });
}

interface BuiltComboMotion {
  frames: InputFrame[];
  firstAction: ActionId;
  resolvedSteps: readonly { action: ActionId; delay: number }[];
}

/**
 * Stitch a combo's steps into a single continuous input sequence.
 * Each step is resolved (role→action), then its motion frames are
 * appended with the requested neutral gap between them.
 *
 * Returns null if the combo yields an empty sequence (shouldn't
 * happen unless the moveset is incomplete).
 */
export function buildComboMotion(
  combo: ComboScript,
  moveset: CharacterMoveset,
  state: GameState,
): BuiltComboMotion | null {
  const frames: InputFrame[] = [];
  const resolvedSteps: { action: ActionId; delay: number }[] = [];
  let firstAction: ActionId | null = null;
  const debugParts: string[] = [];

  for (let i = 0; i < combo.steps.length; i++) {
    const step = combo.steps[i]!;
    const action = resolveAction(step.do, moveset, state);
    const motion = resolveMotion(action);
    const delay = step.delayBeforeFrames ?? 0;
    resolvedSteps.push({ action, delay });
    if (firstAction === null) firstAction = action;

    const prevLen = frames.length;
    if (i > 0) insertNeutralGap(frames, delay);
    appendActionResult(frames, motion, i < combo.steps.length - 1);
    const stepFrames = frames.length - prevLen;
    const tag = i === 0 ? '' : (delay === 0 ? ' cancel' : ` +${delay}f`);
    debugParts.push(`${action}(${stepFrames}f${tag})`);
  }

  if (frames.length === 0 || firstAction === null) return null;
  // Total frame count + per-step breakdown for debugging.
  console.log(`[combo-build] ${combo.name}: ${debugParts.join(' → ')} = ${frames.reduce((s, f) => s + (f.frames ?? 1), 0)}f total`);
  return { frames, firstAction, resolvedSteps };
}

function appendActionResult(
  target: InputFrame[],
  res: ActionResult,
  stripRelease: boolean,
): void {
  if (res.kind === 'noop') return;
  const raw = res.kind === 'motion'
    ? [...res.frames]
    : [{ held: res.held, frames: res.frames }];
  const toAppend = stripRelease ? stripTrailingRelease(raw) : raw;
  for (const f of toAppend) target.push(f);
}

/**
 * Dev-time validator. For each consecutive step pair, verify the link
 * window is feasible given the current frame data. Reports dropped
 * (invalid) combos to console.warn.
 *
 * The validator is intentionally best-effort: it treats every step as
 * a "link" after the previous one (hitstun-constrained). Cancels are
 * harder to validate without knowing the exact cancel frame — we skip
 * the check when `delayBeforeFrames <= 0` and trust the combo author.
 */
export function validateCombo(combo: ComboScript): string[] {
  const warnings: string[] = [];
  const steps = combo.steps;
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1]!;
    const cur = steps[i]!;
    const delay = cur.delayBeforeFrames ?? 0;
    // Only validate genuine links. Cancels (delay <= 0) are author-trusted.
    if (delay <= 0) continue;
    const prevAction = ruleActionAsId(prev.do);
    const curAction = ruleActionAsId(cur.do);
    if (!prevAction || !curAction) continue;
    const window = computeLinkWindow(prevAction, curAction);
    if (!window.feasible) {
      warnings.push(`${combo.name} step ${i}: ${prevAction} → ${curAction} cannot link (no frame advantage)`);
      continue;
    }
    if (delay > window.latestStartFrameFromAHit) {
      warnings.push(`${combo.name} step ${i}: delay ${delay}f exceeds link window ${window.latestStartFrameFromAHit}f for ${prevAction}→${curAction}`);
    }
  }
  return warnings;
}

function ruleActionAsId(a: ComboStep['do']): ActionId | null {
  if (typeof a !== 'string') return null;
  if (a.startsWith('role:')) return null; // can't validate without moveset resolved
  return a as ActionId;
}

/** Validate every combo, log warnings once at module load. */
export function validateAllCombos(combos: readonly ComboScript[]): void {
  for (const combo of combos) {
    const warns = validateCombo(combo);
    for (const w of warns) console.warn(`[combo-validator] ${w}`);
  }
}

// Re-export for tier-runner consumption without circular import.
export type { BuiltComboMotion };
// Re-export getFrameData for potential external callers.
export { getFrameData };
