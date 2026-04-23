import type { GameState } from '../types';
import { ModeManager, TurtleSpaceControl, MODE_REGISTRY, type Mode } from './modes';
import { PolicyRunner, DEFAULT_RYU_POLICY, type Policy } from './policy';
import type { DifficultyLevel } from './policy/difficulty';
import { KEN_MOVESET, getMoveset } from './characters';
import type { CharacterMoveset } from './characters/types';
import type { CharacterId } from '../types';
import type { VirtualInputChannel } from './input-sequencer';
import { TasPilot } from './tas/pilot';
import { KenCalibrationPilot } from './tas/calibration-pilot';

export interface AiFighterOptions {
  /** Mode name to start the match in (legacy mode-based engine). */
  initialMode?: string;
  /** Switch to the policy engine (DSL rules) instead of the mode engine. */
  enginePolicy?: boolean;
  /** Difficulty level for the policy engine. Defaults to 'normal'. */
  level?: DifficultyLevel;
  /** Moveset for the controlled character. Defaults to Ken. */
  moveset?: CharacterMoveset;
  /** Debug: force Ken to loop a single action. Bypasses tier logic. */
  debugLoopAction?: string;
  /** Phase 1 harness: run the Ken move-map calibration routine instead
   *  of the regular TAS pilot. Overrides every other engine flag. */
  calibrateKen?: boolean;
}

/**
 * Controls P2 programmatically. Two execution engines live side by side:
 *
 *   - Mode engine (ModeManager) — hand-written modes picked by Claude.
 *     Stable, limited expressivity.
 *   - Policy engine (PolicyRunner) — DSL rules, Claude can compose a full
 *     policy from primitives at runtime. Richer but experimental.
 *
 * Pick via the `enginePolicy` option. Default stays on modes until the
 * policy engine is battle-tested.
 */
export class AiFighter {
  private readonly modeManager: ModeManager | null;
  private readonly policyRunner: PolicyRunner | null;
  private readonly tasPilot: TasPilot | null;
  private readonly calibrationPilot: KenCalibrationPilot | null;
  private detectedCharId: CharacterId | null = null;

  constructor(channel: VirtualInputChannel, opts: AiFighterOptions = {}) {
    const level = opts.level ?? 'tas';
    // Calibration mode wins over every engine flag.
    if (opts.calibrateKen) {
      this.modeManager = null;
      this.policyRunner = null;
      this.tasPilot = null;
      this.calibrationPilot = new KenCalibrationPilot(channel);
      return;
    }
    this.calibrationPilot = null;
    // TAS level uses the new oracle-based pilot — deterministic single
    // function state → action, no tier dice, no combo stitching.
    // Wins over any engine flag: level=tas always routes here.
    if (level === 'tas') {
      this.modeManager = null;
      this.policyRunner = null;
      this.tasPilot = new TasPilot(channel);
    } else if (opts.enginePolicy) {
      this.modeManager = null;
      this.tasPilot = null;
      const moveset = opts.moveset ?? KEN_MOVESET;
      this.policyRunner = new PolicyRunner(channel, DEFAULT_RYU_POLICY, moveset, level);
      if (opts.debugLoopAction) {
        this.policyRunner.setDebugLoopAction(opts.debugLoopAction);
      }
    } else {
      const initial = opts.initialMode && MODE_REGISTRY[opts.initialMode]
        ? MODE_REGISTRY[opts.initialMode]!
        : TurtleSpaceControl;
      this.modeManager = new ModeManager(channel, initial);
      this.policyRunner = null;
      this.tasPilot = null;
    }
  }

  onVblank(state: GameState): void {
    // Auto-detect P2's character and swap moveset if it changed
    // (character select between rounds, different match, etc).
    if (this.policyRunner && state.p2.charId !== 'unknown' && state.p2.charId !== this.detectedCharId) {
      this.detectedCharId = state.p2.charId;
      this.policyRunner.setMoveset(getMoveset(state.p2.charId));
    }
    this.modeManager?.onVblank(state);
    this.policyRunner?.onVblank(state);
    this.tasPilot?.onFrame(state);
    this.calibrationPilot?.onFrame(state);
  }

  /** Mode engine: switch active mode. */
  setMode(modeName: string): boolean {
    const mode = MODE_REGISTRY[modeName];
    if (!mode || !this.modeManager) return false;
    this.modeManager.setMode(mode);
    return true;
  }

  /** Policy engine: install a new policy (usually from Claude). */
  setPolicy(policy: Policy): boolean {
    if (!this.policyRunner) return false;
    this.policyRunner.setPolicy(policy);
    return true;
  }

  getCurrentMode(): Mode | null {
    return this.modeManager?.getCurrentMode() ?? null;
  }

  getCurrentPolicy(): Policy | null {
    return this.policyRunner?.getPolicy() ?? null;
  }

  /** True if running the DSL policy engine. */
  usesPolicyEngine(): boolean { return this.policyRunner !== null; }

  /** Current calibration move (null if not in calibration mode or
   *  the schedule is finished). Exposed so the trajectory-recording
   *  freezer can adapt Ken's anchor X per-move. */
  currentCalibrationMove(): string | null {
    return this.calibrationPilot?.currentMove() ?? null;
  }

  reset(): void {
    this.modeManager?.reset();
    this.policyRunner?.reset();
    this.tasPilot?.reset();
    this.calibrationPilot?.reset();
  }
}
