import {
  buildSystemPrompt,
  buildUserPrompt,
  buildOpponentBriefingPrompt,
  type CoachLanguage,
  type PromptContext,
} from './prompt-builder';
import { streamComment } from './claude-client';
import type { CoachEvent } from '../detector/events';
import type { DerivedMetrics } from '../extractor/state-history';
import type { GameState, AIMacroState } from '../types';

const MIN_INTERVAL_MS = 4500;
const URGENT_INTERVAL_MS = 1500;
const MAX_SILENCE_MS = 8000;
const URGENT_IMPORTANCE = 0.85;
const INTERESTING_IMPORTANCE = 0.55;

export interface OrchestratorOpts {
  /** Called with each streamed token so the UI can append live. */
  onToken(token: string): void;
  /** Called when a comment finishes streaming. */
  onCommentDone?(fullText: string): void;
  /** Called on LLM errors so the UI can fall back silently. */
  onError?(err: string): void;
  /** Output language. Defaults to English. */
  language?: CoachLanguage;
  now?(): number;
}

/**
 * Decides WHEN to ask Claude for a line, then pipes the streamed tokens
 * to the UI. One comment at a time — new events queue behind the current
 * stream. Anti-spam + anti-repetition happen here, not on the LLM side.
 */
export class CommentOrchestrator {
  private readonly systemPrompt: string;
  private readonly language: CoachLanguage;
  private readonly onToken: OrchestratorOpts['onToken'];
  private readonly onCommentDone: OrchestratorOpts['onCommentDone'];
  private readonly onError: OrchestratorOpts['onError'];
  private readonly now: () => number;

  private lastSpokeAtMs = -Infinity;
  private recentComments: string[] = [];
  private readonly commentHistoryCap = 6;
  private inFlight: AbortController | null = null;
  private pendingUrgentEvent: CoachEvent | null = null;
  private briefedOpponents = new Set<string>();

  constructor(opts: OrchestratorOpts) {
    this.language = opts.language ?? 'en';
    this.systemPrompt = buildSystemPrompt(this.language);
    this.onToken = opts.onToken;
    this.onCommentDone = opts.onCommentDone;
    this.onError = opts.onError;
    this.now = opts.now ?? (() => performance.now());
  }

  /** Feed every event — the orchestrator decides which ones to react to. */
  ingest(
    state: GameState,
    events: CoachEvent[],
    eventBuffer: CoachEvent[],
    macroState: AIMacroState,
    derived: DerivedMetrics,
    context: PromptContext,
  ): void {
    if (this.inFlight) return;

    // Briefing takes absolute priority: the first round_start against
    // a fighter we haven't seen yet gets an introductory line that
    // names the character and hints at a counter.
    const roundStart = events.find(e => e.type === 'round_start');
    const charId = state.p2.charId;
    if (roundStart && charId && charId !== 'unknown' && !this.briefedOpponents.has(charId)) {
      this.briefedOpponents.add(charId);
      this.speakBriefing(charId);
      return;
    }

    const nowMs = this.now();
    const sinceLastMs = nowMs - this.lastSpokeAtMs;

    const urgent = events.find(e => e.importance >= URGENT_IMPORTANCE);
    const interesting = events.find(e => e.importance >= INTERESTING_IMPORTANCE);

    let shouldSpeak = false;
    if (urgent && sinceLastMs > URGENT_INTERVAL_MS) {
      shouldSpeak = true;
      this.pendingUrgentEvent = urgent;
    } else if (interesting && sinceLastMs > MIN_INTERVAL_MS) {
      shouldSpeak = true;
    } else if (sinceLastMs > MAX_SILENCE_MS) {
      shouldSpeak = true;
    }
    if (!shouldSpeak) return;

    this.speak(state, eventBuffer, macroState, derived, context);
  }

  cancel(): void {
    this.inFlight?.abort();
    this.inFlight = null;
  }

  private speakBriefing(charId: string): void {
    this.lastSpokeAtMs = this.now();
    const controller = new AbortController();
    this.inFlight = controller;
    let buffer = '';

    streamComment(
      {
        systemPrompt: this.systemPrompt,
        userPrompt: buildOpponentBriefingPrompt(charId, this.language),
        maxTokens: 90,
        signal: controller.signal,
      },
      {
        onToken: (t) => { buffer += t; this.onToken(t); },
        onDone: () => {
          const text = buffer.trim();
          if (text) {
            this.recentComments.push(text);
            if (this.recentComments.length > this.commentHistoryCap) this.recentComments.shift();
            this.onCommentDone?.(text);
          }
          this.inFlight = null;
        },
        onError: (err) => {
          this.inFlight = null;
          this.onError?.(err);
        },
      },
    );
  }

  private speak(
    state: GameState,
    eventBuffer: CoachEvent[],
    macroState: AIMacroState,
    derived: DerivedMetrics,
    context: PromptContext,
  ): void {
    this.lastSpokeAtMs = this.now();
    const controller = new AbortController();
    this.inFlight = controller;
    let buffer = '';

    const userPrompt = buildUserPrompt({
      state,
      recentEvents: eventBuffer,
      recentComments: this.recentComments,
      macroState,
      opponentCharId: state.p2.charId,
      derived,
      context,
      language: this.language,
    });

    streamComment(
      { systemPrompt: this.systemPrompt, userPrompt, maxTokens: 48, signal: controller.signal },
      {
        onToken: (t) => {
          buffer += t;
          this.onToken(t);
        },
        onDone: () => {
          const text = buffer.trim();
          if (text) {
            this.recentComments.push(text);
            if (this.recentComments.length > this.commentHistoryCap) this.recentComments.shift();
            this.onCommentDone?.(text);
          }
          this.inFlight = null;
        },
        onError: (err) => {
          this.inFlight = null;
          this.onError?.(err);
        },
      },
    );
  }
}
