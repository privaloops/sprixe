export type CharacterId =
  | 'ryu'
  | 'ken'
  | 'chun-li'
  | 'guile'
  | 'blanka'
  | 'zangief'
  | 'e-honda'
  | 'dhalsim'
  | 'balrog'
  | 'vega'
  | 'sagat'
  | 'bison'
  | 'unknown';

export type RoundPhase = 'intro' | 'fight' | 'ko' | 'outro';

export type AttackPhase = 'startup' | 'active' | 'recovery' | null;

export type AIMacroState =
  | 'idle'
  | 'zoning'
  | 'rush'
  | 'defensive'
  | 'corner_pressure'
  | 'charge_building'
  | 'desperation'
  | 'teleport_setup'
  | 'unknown';

/** Active collision rectangle in world coordinates (pixel-accurate).
 *  Extracted from SF2HF RAM each frame via the animation_ptr + hitbox_ptr
 *  two-level indirection that the game itself uses. */
export interface HitboxRect {
  /** Rectangle center X in world coords. */
  cx: number;
  /** Rectangle center Y in world coords. */
  cy: number;
  /** Half-width (so left = cx - halfW, right = cx + halfW). */
  halfW: number;
  /** Half-height. */
  halfH: number;
  /** Which role this box plays in the collision system. */
  kind: 'attack' | 'hurt_head' | 'hurt_body' | 'hurt_legs' | 'push';
}

export interface CharacterState {
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  charId: CharacterId;
  animState: number;
  stunCounter: number;
  comboCount: number;
  isBlocking: boolean;
  isJumping: boolean;
  isCrouching: boolean;
  isAirborne: boolean;
  /** Animation frame pointer (32-bit BE). The canonical "current move"
   *  signature — changes every time the character transitions to a
   *  new animation. Calibration maps ptr value → move name. */
  animPtr: number;
  /** FSM state byte. 0=neutral, 0x02=walk, 0x04=jump, 0x0A=normal
   *  attack, 0x0C=special attack, 0x0E=hurt. */
  stateByte: number;
  /** True while the attacking flag (+0x18B) is 0x01. */
  attacking: boolean;
  /** Yoke byte from animation frame metadata (ROM, at animPtr+0x17).
   *  Capcom's own AI uses it to classify states: 0xFF = standing/walking,
   *  0x17 = neutral jump, 0x06 = forward/back jump, other = attack-specific. */
  yoke: number;
  /** Yoke2 byte (animPtr+0x16): 0x00 during startup/active frames,
   *  0x01 during recovery. Canonical punish-window signal. */
  yoke2: number;
  /** Derived from yoke2: true while the character is in move recovery. */
  isRecovery: boolean;
  /** Pixel-accurate world Y (signed word at base+0x0A). Screen Y grows down.
   *  Optional because older test fixtures may not populate it. */
  posY?: number;
  /** Facing byte — 1 = facing left, 0 = facing right. */
  facingLeft?: boolean;
  /** Hurtboxes (head / body / legs). Up to 3. */
  hurtboxes?: HitboxRect[];
  /** Active attack hitbox, or null if no active attack this frame. */
  attackbox?: HitboxRect | null;
  /** Push (body collision) box. */
  pushbox?: HitboxRect | null;
  /** Per-character hitbox directory pointer (32-bit ROM address at
   *  player_base+0x34). Needed by the forward simulator to resolve an
   *  arbitrary future animation frame's boxes via the same two-level
   *  indirection the extractor uses. */
  hitboxPtr?: number;
}

export interface CPUState extends CharacterState {
  aiState: AIMacroState;
  chargeCounter: number;
  retreatCounter: number;
  lastSpecialFrame: number;
}

export interface GameState {
  frameIdx: number;
  timestampMs: number;
  p1: CharacterState;
  p2: CPUState;
  timer: number;
  roundNumber: number;
  roundPhase: RoundPhase;
  /** Camera left edge in world coords (signed word at 0xFF8BC4).
   *  screen_x = world_x - cameraX. Optional for backward compat. */
  cameraX?: number;
}
