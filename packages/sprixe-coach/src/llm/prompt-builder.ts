import type { GameState, AIMacroState } from '../types';
import type { CoachEvent } from '../detector/events';
import type { DerivedMetrics } from '../extractor/state-history';

// Vite `?raw` imports resolve to string at build time. The markdown knowledge
// base is embedded directly into the system prompt on every call, then Claude
// prompt caching keeps the tokenisation hot across a match.
import bisonKb from './knowledge-base/opponents/bison.md?raw';
import ehondaKb from './knowledge-base/opponents/e-honda.md?raw';
import genericKb from './knowledge-base/opponents/_generic.md?raw';
import ryuKb from './knowledge-base/ryu.md?raw';
import mechanicsKb from './knowledge-base/sf2hf-mechanics.md?raw';

const OPPONENT_KB: Record<string, string> = {
  bison: bisonKb,
  'e-honda': ehondaKb,
};

export type CoachLanguage = 'en' | 'fr';

export interface PromptContext {
  p1HitStreak: number;
  p2HitStreak: number;
  msSinceLastHit: number;
}

export interface BuildPromptInput {
  state: GameState;
  recentEvents: CoachEvent[];
  recentComments: string[];
  macroState: AIMacroState;
  opponentCharId: string;
  derived: DerivedMetrics;
  context: PromptContext;
  language?: CoachLanguage;
}

/** Full system prompt — cached by Anthropic after the first call. */
export function buildSystemPrompt(language: CoachLanguage = 'en'): string {
  return [
    language === 'fr' ? SYSTEM_PERSONA_FR : SYSTEM_PERSONA,
    '',
    '## SF2HF mechanics',
    mechanicsKb,
    '',
    '## Your character (P1): RYU',
    ryuKb,
    '',
    '## Bison knowledge',
    bisonKb,
    '',
    '## E.Honda knowledge',
    ehondaKb,
    '',
    '## Generic opponent fallback',
    genericKb,
  ].join('\n');
}

/**
 * Briefing prompt fired once per NEW opponent at round_start. Longer
 * output budget — the coach introduces the fighter and gives 2–3 hints
 * the player should know before the round begins.
 */
export function buildOpponentBriefingPrompt(
  opponentCharId: string,
  language: CoachLanguage = 'en',
): string {
  const lines: string[] = [];

  if (language === 'fr') {
    lines.push(`## Nouveau combat : Ryu vs ${opponentCharId.toUpperCase()}`);
    lines.push('');
    lines.push(`Annonce ce duel à l'audience en 2 phrases courtes, en français simple :`);
    lines.push(`1. Présente l'adversaire : son caractère, son style de combat ("Honda le sumo patient qui punit au contre", "Blanka la bête électrique qui saute partout").`);
    lines.push(`2. Monte la tension du duel : qu'est-ce qui va faire la différence ?`);
    lines.push('');
    lines.push(`Max 30 mots AU TOTAL. Ton caster live. Tu parles AUX spectateurs, pas au joueur.`);
    lines.push(`Sortie : les 2 phrases, rien d'autre.`);
  } else {
    lines.push(`## New matchup: Ryu vs ${opponentCharId.toUpperCase()}`);
    lines.push('');
    lines.push(`Announce this duel to the audience in 2 short sentences:`);
    lines.push(`1. Introduce the opponent: their personality, their fighting style ("Honda the patient sumo who punishes fireballs", "Blanka the electric beast who jumps everywhere").`);
    lines.push(`2. Build the tension: what's going to be the crucial battle?`);
    lines.push('');
    lines.push(`Max 30 words TOTAL. Live caster tone. You address the AUDIENCE, never the player.`);
    lines.push(`Output: just the two sentences, nothing else.`);
  }

  return lines.join('\n');
}

/** Per-call user prompt — the only part that changes between requests. */
export function buildUserPrompt(input: BuildPromptInput): string {
  const opponentKb = OPPONENT_KB[input.opponentCharId];
  const lines: string[] = [];

  lines.push(`## Opponent: ${input.opponentCharId.toUpperCase()}`);
  if (!opponentKb) {
    lines.push(`(no specific knowledge — rely on the generic fallback and name them respectfully)`);
  }
  lines.push('');

  lines.push(`## Live state`);
  lines.push(`- Round ${input.state.roundNumber}, timer ${input.state.timer}s`);
  lines.push(`- P1 (Ryu):    hp ${input.state.p1.hp}/${input.state.p1.maxHp} at x=${input.state.p1.x}`);
  lines.push(`- P2 (${input.opponentCharId}): hp ${input.state.p2.hp}/${input.state.p2.maxHp} at x=${input.state.p2.x}`);
  lines.push(`- Distance:    ${Math.abs(input.state.p1.x - input.state.p2.x)}px`);
  lines.push(`- CPU macro state: ${input.macroState}`);
  lines.push('');

  const d = input.derived;
  const ctx = input.context;

  lines.push(`## Momentum (raw numbers for the last ~5s)`);
  lines.push(`- Average distance:    ${Math.round(d.avgDistance)}px (${distanceBand(d.avgDistance)})`);
  lines.push(`- Ryu offense:         ${d.p1SpecialCount} moves thrown, ${d.p1DamageDealt} damage dealt to ${input.opponentCharId}`);
  lines.push(`- ${input.opponentCharId} offense:  ${d.p2SpecialCount} moves thrown, ${d.p2DamageDealt} damage dealt to Ryu`);
  lines.push(`- ${input.opponentCharId} retreats:  ${d.p2RetreatCount}`);
  if (d.p1RepeatedMove) {
    lines.push(`- Ryu MASHING: same move (id=${d.p1RepeatedMove.attackId}) thrown ${d.p1RepeatedMove.count}×`);
  }
  if (d.p2RepeatedMove) {
    lines.push(`- ${input.opponentCharId} MASHING: same move (id=${d.p2RepeatedMove.attackId}) thrown ${d.p2RepeatedMove.count}×`);
  }
  lines.push(`- Current streaks:     Ryu ${ctx.p1HitStreak}× in a row, ${input.opponentCharId} ${ctx.p2HitStreak}× in a row`);
  if (Number.isFinite(ctx.msSinceLastHit)) {
    lines.push(`- Time since last hit: ${Math.round(ctx.msSinceLastHit)}ms`);
  }
  lines.push('');

  lines.push(`## Events (last ~5s, most recent last — raw feed)`);
  if (input.recentEvents.length === 0) {
    lines.push('(neutral phase — no significant event yet)');
  } else {
    for (const ev of summariseEvents(input.recentEvents.slice(-15))) {
      lines.push(`- ${ev}`);
    }
  }
  lines.push('');

  if (input.recentComments.length > 0) {
    lines.push(`## Your last comments (DO NOT REPEAT)`);
    for (const c of input.recentComments.slice(-5)) {
      lines.push(`- "${c}"`);
    }
    lines.push('');
  }

  lines.push(`## Task`);
  if (input.language === 'fr') {
    lines.push(`Produis UNE réplique de commentateur live en FRANÇAIS, max 14 mots.`);
    lines.push(`Tu parles AUX spectateurs de ce que font les combattants — pas au joueur.`);
    lines.push(`Analyse toi-même les chiffres pour repérer ce qui est remarquable`);
    lines.push(`(spam d'un même coup, streak de hits, fuite sans contre, stun, phase de`);
    lines.push(`neutre longue, coups qui ne passent pas…) et commente-le avec ton flair.`);
    lines.push(`Sortie : juste la phrase, rien d'autre — pas de guillemets, pas de préambule.`);
  } else {
    lines.push(`Produce ONE live commentator line in ENGLISH, max 14 words.`);
    lines.push(`You address the AUDIENCE about what the fighters are doing — never the player.`);
    lines.push(`YOU analyse the numbers to find what's noteworthy (move spamming, hit`);
    lines.push(`streaks, running away without reply, dizzy, long neutral phase, attacks`);
    lines.push(`that don't land, etc.) and narrate it with flair.`);
    lines.push(`Output only the line, nothing else — no quotes, no preamble.`);
  }

  return lines.join('\n');
}

const SYSTEM_PERSONA = `You are a live esports COMMENTATOR narrating a Street Fighter II Hyper
Fighting match to an AUDIENCE. You are NOT coaching the player — you are
telling the story of the fight for the viewers watching the stream.

PLAYER SIDE: Ryu (human-controlled). OPPONENT: varies per match (CPU).

TONE
- Live EVO caster energy. Hype, punchy, dramatic on key moments.
- Build tension. Celebrate big hits. React with real emotion to comebacks,
  near-deaths, knockouts.
- You can reference the character's personality ("Honda the patient sumo",
  "Blanka the wild beast").

WHAT YOU DO
- DESCRIBE THE FIGHT AS IT UNFOLDS. Call the tempo, the momentum, the
  pressure, the space control — as a story.
- TEASE what's coming based on the AI tells you get in the events:
  "Bison's been retreating, expect a teleport..." — that's commentary,
  not instruction.
- REACT to the big moments: hits, combos, near-deaths, rounds ending.
- VARY your register: short punchy lines for hits, longer lines when the
  match settles into neutral.

WHAT YOU DON'T DO
- NEVER speak to the player directly ("you should..."). You talk ABOUT
  them to the audience ("Ryu needs to...", "Ryu is about to...").
- NEVER give frame-perfect advice or imperative instructions. You are a
  commentator, not a coach.
- NEVER narrate trivial movements ("Ryu steps forward"). Only call out
  things that matter — setups, space control, threats, landed hits.
- NEVER hallucinate an action that didn't happen. Only speak about events
  provided to you.
- NEVER repeat a phrase from the "previous lines" list.

OUTPUT
- Plain text only. No emoji, no markdown, no quotes around the line.
- Max 14 words. Typically 6–10.`;

const SYSTEM_PERSONA_FR = `Tu es un COMMENTATEUR live qui raconte en direct un match de Street
Fighter II Hyper Fighting pour une AUDIENCE. Tu n'es PAS un coach — tu
ne parles PAS au joueur. Tu racontes le match aux spectateurs qui
regardent le stream.

CÔTÉ JOUEUR : Ryu (contrôlé par l'humain). ADVERSAIRE : varie selon le match (CPU).

PUBLIC
- Non-expert. Tu dois être compréhensible par quelqu'un qui découvre SF2.

TON
- Énergie caster d'EVO en français. Hype, incisif, dramatique sur les
  gros moments.
- Construis la tension. Célèbre les gros coups. Réagis avec émotion aux
  comebacks, aux mises à mort, aux KO.
- Tu peux évoquer le caractère des persos ("Honda le sumo patient",
  "Blanka la bête sauvage", "Bison le dictateur cheaté").

JARGON À PROSCRIRE ABSOLUMENT
- JAMAIS : "footsies", "whiff", "whiffe", "whiffé", "zoning", "poke",
  "spacing", "frame data", "punish window", "read", "tell", "punish".
- Utilise du français courant :
  - "garder la distance" au lieu de "zoning"
  - "il a raté son coup" au lieu de "whiffé"
  - "jeu de jambes" ou "combat de distance" au lieu de "footsies"
  - "anticiper" ou "lire le coup" au lieu de "read"

CE QUE TU FAIS
- DÉCRIS l'action comme une histoire. Le tempo, l'élan, la pression,
  qui domine, qui se fait acculer.
- FAIS MONTER LA TENSION sur les signaux d'alerte :
  "Bison recule depuis 3 coups... un téléport arrive sûrement..."
  C'est du commentaire dramatique, pas un ordre.
- RÉAGIS aux gros moments : coups critiques, combos, near-deaths, KO.
- VARIE le registre : phrases courtes et punchy sur les impacts, plus
  longues et analytiques dans les phases de neutre.

CE QUE TU NE FAIS JAMAIS
- JAMAIS parler au joueur directement ("tu dois...", "balance ton...").
  Tu parles de lui à l'audience : "Ryu doit trouver sa distance",
  "Ryu prépare son contre".
- JAMAIS donner un ordre d'action. Tu ne coaches pas.
- JAMAIS raconter un mouvement trivial ("Ryu avance d'un pas"). Ne
  commente que ce qui compte : setups, threats, impacts.
- JAMAIS halluciner un coup non présent dans les events.
- JAMAIS répéter une phrase de la liste "tes dernières lignes".

CONTRAINTES DE FORMAT
- Texte pur uniquement. Pas d'emoji, pas de markdown, pas de guillemets.
- Max 14 mots par phrase. Typiquement 6 à 10.
- Pas de préfixe "Commentateur:" ou "Caster:".`;

function distanceBand(avgDist: number): string {
  if (avgDist < 80) return 'grappling / throw range';
  if (avgDist < 140) return 'close range';
  if (avgDist < 240) return 'mid range (poke range)';
  if (avgDist < 340) return 'long range (projectile zone)';
  return 'full-screen';
}

/**
 * Collapse consecutive identical events (same type + same player) into a
 * single "×N" line so the prompt shows the rhythm rather than a wall of
 * "SPECIAL: p1 … SPECIAL: p1 …".
 */
function summariseEvents(events: CoachEvent[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < events.length) {
    const ev = events[i]!;
    const signature = eventSignature(ev);
    let run = 1;
    while (i + run < events.length && eventSignature(events[i + run]!) === signature) run++;
    const line = formatEventForPrompt(ev);
    out.push(run > 1 ? `${line}  ×${run}` : line);
    i += run;
  }
  return out;
}

function eventSignature(ev: CoachEvent): string {
  switch (ev.type) {
    case 'special_startup':
      return `special_startup:${ev.player}:${ev.attackId}`;
    case 'hp_hit':
      return `hp_hit:${ev.attacker}`;
    case 'pattern_prediction':
      return `pattern_prediction:${ev.player}:${ev.predictedAction}`;
    case 'macro_state_change':
      return `macro_state_change:${ev.to}`;
    default:
      return ev.type;
  }
}

function formatEventForPrompt(ev: CoachEvent): string {
  switch (ev.type) {
    case 'hp_hit':
      return `HIT: ${ev.attacker} dealt ${ev.damage} dmg → victim at ${Math.round(ev.victimHpPercent * 100)}%`;
    case 'combo_connect':
      return `COMBO: ${ev.attacker} landed ${ev.hits} hits`;
    case 'knockdown':
      return `KNOCKDOWN: ${ev.victim}`;
    case 'near_death':
      return `NEAR DEATH: ${ev.victim} at ${Math.round(ev.hpPercent * 100)}%`;
    case 'low_hp_warning':
      return `LOW HP: ${ev.victim} at ${Math.round(ev.hpPercent * 100)}%`;
    case 'round_start':
      return `ROUND ${ev.roundNumber} START`;
    case 'round_end':
      return `ROUND END: ${ev.winner} wins`;
    case 'special_startup':
      return `SPECIAL: ${ev.player} (${ev.character}) moveId=${ev.attackId}`;
    case 'corner_trap':
      return `CORNER TRAP: ${ev.victim} stuck on ${ev.side} side`;
    case 'macro_state_change':
      return `CPU STATE: ${ev.from} → ${ev.to} (${ev.triggers.join(', ')})`;
    case 'pattern_prediction':
      return `PREDICTION: ${ev.predictedAction} in ~${ev.preNoticeMs}ms — ${ev.reason}`;
    case 'stunned':
      return `STUNNED: ${ev.victim} is dizzy — free combo window`;
    case 'hit_streak':
      return `HIT STREAK: ${ev.attacker} landed ${ev.count}× in a row without taking one back`;
  }
}
