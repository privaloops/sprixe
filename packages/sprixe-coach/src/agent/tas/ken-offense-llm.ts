import type { GameState } from '../../types';
import type { ActionId } from '../policy/types';
import {
  InputSequencer,
  type VirtualButton,
  type VirtualInputChannel,
  type InputFrame,
} from '../input-sequencer';
import { resolveMotion } from '../policy/actions';

/**
 * KenOffenseLlm — LLM-driven offensive policy for Ken (P2).
 *
 * Defence stays in the synchronous `KenCounterAi` (reactive, 60 Hz,
 * zero-latency). This module is asked only "what offensive action
 * next?" and polls Claude via the dev proxy `/api/coach/generate`.
 *
 * Request cadence: ~800 ms. Claude's response (250-500 ms) is buffered
 * into `pendingAction`; the synchronous onVblank consumes it the next
 * frame Ken is in neutral. The LLM is never in the critical path for
 * defence — a live attackbox triggers `KenCounterAi` first and the
 * offense buffer is simply held until Ken becomes idle again.
 *
 * Coordination with the defence module: we only fire when `stateByte
 * === 0x00` AND our own sequencer is free. Defensive actions from
 * `KenCounterAi` use a different sequencer bound to the same channel;
 * checking `p2.stateByte` picks up that Ken is already animating.
 */

/** Minimum frames between two offensive fires. 36f ≈ 600 ms — long
 *  enough for a hadouken to commit, short enough to feel reactive. */
const FIRE_COOLDOWN_FRAMES = 36;

/** Min wait after a successful response before re-polling (ms). We
 *  poll consecutively (next call starts as soon as the previous one
 *  resolves), so this is just a small breath to avoid hammering when
 *  the server returns instantly from a cached hit. */
const LLM_MIN_INTERVAL_MS = 150;

/** Output cap. Response is JSON with `action` + `reason` so 60 tokens
 *  is plenty for a one-line answer. Keeping it low shaves latency. */
const LLM_MAX_TOKENS = 60;

/** Model id. Haiku 4.5 delivers 300-500 ms round-trips through the
 *  dev proxy — fast enough that decisions are still relevant when
 *  they arrive. Sonnet 4.6 gives better tactics but its 1.5-3.5s
 *  latency made every decision stale by the time it executed. */
const LLM_MODEL = 'claude-haiku-4-5-20251001';

/** Offensive vocabulary exposed to the LLM. Maps 1:1 to ActionId
 *  entries in resolveMotion(). Defence primitives (block_*, anti-air
 *  shoryu vs airborne, throw tech) are intentionally absent — those
 *  are the synchronous counter-AI's job. */
const OFFENSE_ACTIONS = [
  'neutral',
  'walk_forward',
  'walk_back',
  'jump_neutral',
  'jump_back',
  'jump_forward_lk',
  'jump_forward_mk',
  'jump_forward_hk',
  'jump_forward_lp',
  'jump_forward_mp',
  'jump_forward_hp',
  'hadouken_jab',
  'hadouken_strong',
  'hadouken_fierce',
  'shoryu_jab',
  'shoryu_strong',
  'shoryu_fierce',
  'tatsu_lk',
  'tatsu_mk',
  'tatsu_hk',
  'throw_forward',
  'throw_back',
  'crouch_jab',
  'crouch_short',
  'crouch_mk',
  'crouch_fierce',
  'sweep',
  'standing_jab',
  'standing_forward',
  'standing_fierce',
] as const satisfies readonly ActionId[];

type OffenseAction = typeof OFFENSE_ACTIONS[number];
const OFFENSE_SET: ReadonlySet<string> = new Set(OFFENSE_ACTIONS);

const SYSTEM_PROMPT = [
  'You control Ken (P2) in Street Fighter II Hyper Fighting, facing Ryu (P1).',
  'You decide ONLY offensive actions. Defence (blocking, anti-air shoryu, throw tech) is handled by a separate reactive module — never recommend block, do not recommend shoryu as an anti-air, do not recommend throw tech.',
  '',
  'Game context:',
  '- Distance units are world pixels. Stage is ~1000px wide. Characters are ~40px wide push-boxes.',
  '- dist <40: throw range. 40-100: poke range (cLK, cMK, sweep). 100-180: mid-screen (walk forward, hadouken). 180-280: mid-far (hadouken zoning). >280: full screen.',
  '- A hadouken fireball takes ~45 frames to cross the screen.',
  '- Jump-in (jump_forward_hk / hp) is the standard reward approach from mid to far.',
  '- tatsu travels through Ryu\'s hadouken at jab altitude (tatsu_lk/mk). Shoryu is invincible reversal, only use offensively to punish visible recovery.',
  '- cornered opponent: pressure with pokes, cross-ups and jump-ins.',
  '- cornered self: create space with jump_back or a reversal hadouken.',
  '',
  `Available actions: ${OFFENSE_ACTIONS.join(', ')}.`,
  '',
  'Reply with STRICT JSON and nothing else: {"action":"<action>","reason":"<max 12 words>"}.',
  'Pick exactly one action from the list. No trailing commas, no markdown fences.',
].join('\n');

export class KenOffenseLlm {
  private readonly sequencer: InputSequencer;
  private pendingAction: OffenseAction | null = null;
  private pendingReason = '';
  private lastFiredFrame = -Infinity;
  private requestInFlight = false;
  private latestState: GameState | null = null;
  private latestKenAction: OffenseAction = 'neutral';
  private latestRyuMove: string | null = null;
  private disposed = false;

  constructor(private readonly channel: VirtualInputChannel) {
    this.sequencer = new InputSequencer(channel);
    console.log('[ken-offense-llm] armed, consecutive polling');
    // Consecutive polling loop: next request starts as soon as the
    // previous one resolves (plus a tiny breath). This keeps the
    // pipeline saturated regardless of actual round-trip time.
    void this.pollLoop();
  }

  private async pollLoop(): Promise<void> {
    while (!this.disposed) {
      await this.poll();
      await new Promise(r => setTimeout(r, LLM_MIN_INTERVAL_MS));
    }
  }

  onVblank(state: GameState): void {
    this.sequencer.tick();
    this.latestState = state;
    if (this.sequencer.busy) return;
    if (state.frameIdx - this.lastFiredFrame < FIRE_COOLDOWN_FRAMES) return;
    // Wait for Ken to come back to neutral before firing the next
    // buffered action. The defence module owns 0x0A / 0x0C / 0x04.
    if (state.p2.stateByte !== 0x00) return;
    if (!this.pendingAction) return;

    const action = this.pendingAction;
    const reason = this.pendingReason;
    this.pendingAction = null;
    this.pendingReason = '';
    console.log(
      `[ken-offense-llm] f=${state.frameIdx} exec ${action} — ${reason}`,
    );
    this.executeMotion(action, state);
    this.lastFiredFrame = state.frameIdx;
    this.latestKenAction = action;
  }

  reset(): void {
    this.sequencer.clear();
    this.channel.releaseAll();
    this.pendingAction = null;
    this.pendingReason = '';
    this.lastFiredFrame = -Infinity;
  }

  /** Stop the polling loop. Call when tearing down the controller. */
  dispose(): void {
    this.disposed = true;
  }

  private async poll(): Promise<void> {
    if (this.disposed) return;
    if (this.requestInFlight) return;
    const state = this.latestState;
    if (!state) return;
    if (state.roundPhase !== 'fight') return;
    this.requestInFlight = true;
    const t0 = performance.now();
    try {
      const payload = buildStatePayload(state, this.latestKenAction, this.latestRyuMove);
      const resp = await fetch('/api/coach/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt: SYSTEM_PROMPT,
          userPrompt: JSON.stringify(payload),
          maxTokens: LLM_MAX_TOKENS,
          model: LLM_MODEL,
        }),
      });
      if (!resp.ok || !resp.body) {
        console.warn('[ken-offense-llm] http', resp.status);
        return;
      }
      const text = await consumeSseText(resp.body);
      const parsed = parseDecision(text);
      if (!parsed) {
        console.warn('[ken-offense-llm] bad response:', text.slice(0, 120));
        return;
      }
      const dt = (performance.now() - t0).toFixed(0);
      this.pendingAction = parsed.action;
      this.pendingReason = parsed.reason;
      console.log(`[ken-offense-llm] ${dt}ms → ${parsed.action} "${parsed.reason}"`);
    } catch (e) {
      console.warn('[ken-offense-llm] error', e);
    } finally {
      this.requestInFlight = false;
    }
  }

  private executeMotion(action: OffenseAction, state: GameState): void {
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

interface StatePayload {
  t: number;
  dist: number;
  ken: { hp: number; x: number; corner: boolean; st: string };
  ryu: { hp: number; x: number; corner: boolean; st: string; airborne: boolean; recovery: boolean };
  last_ken: string;
}

function buildStatePayload(
  state: GameState,
  lastKenAction: OffenseAction,
  _lastRyuMove: string | null,
): StatePayload {
  const dist = Math.abs(state.p1.x - state.p2.x);
  return {
    t: state.frameIdx,
    dist,
    ken: {
      hp: state.p2.hp,
      x: state.p2.x,
      corner: state.p2.x < 120 || state.p2.x > 880,
      st: stateName(state.p2.stateByte),
    },
    ryu: {
      hp: state.p1.hp,
      x: state.p1.x,
      corner: state.p1.x < 120 || state.p1.x > 880,
      st: stateName(state.p1.stateByte),
      airborne: state.p1.isAirborne,
      recovery: state.p1.isRecovery,
    },
    last_ken: lastKenAction,
  };
}

function stateName(stateByte: number): string {
  switch (stateByte) {
    case 0x00: return 'idle';
    case 0x02: return 'walk';
    case 0x04: return 'jump';
    case 0x06: return 'crouch';
    case 0x0A: return 'attack_normal';
    case 0x0C: return 'attack_special';
    case 0x0E: return 'hurt';
    default:   return `0x${stateByte.toString(16).padStart(2, '0')}`;
  }
}

/**
 * Consume the SSE stream emitted by `/api/coach/generate` and stitch
 * token deltas into the full assistant text. Stops at the `done` event
 * or when the stream ends.
 */
async function consumeSseText(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIdx;
    // eslint-disable-next-line no-cond-assign
    while ((newlineIdx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (typeof data.token === 'string') text += data.token;
          if (data.done) return text;
          if (data.error) {
            console.warn('[ken-offense-llm] sse error', data.error);
            return text;
          }
        } catch {
          /* ignore malformed SSE frames */
        }
      }
    }
  }
  return text;
}

/**
 * Parse Claude's one-line JSON answer into a validated action + reason.
 * Tolerant to leading whitespace, trailing commentary, or code fences.
 * Returns null if the action isn't in the allow-list.
 */
function parseDecision(raw: string): { action: OffenseAction; reason: string } | null {
  const trimmed = raw.trim();
  // Strip ```json ... ``` fences if the model slips one in.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1]! : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < firstBrace) return null;
  try {
    const obj = JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    const action = String(obj.action ?? '').trim();
    const reason = String(obj.reason ?? '').trim();
    if (!OFFENSE_SET.has(action)) return null;
    return { action: action as OffenseAction, reason };
  } catch {
    return null;
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
