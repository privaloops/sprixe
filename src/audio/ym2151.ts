/**
 * YM2151 (OPM) — 4-Operator FM Synthesizer
 *
 * 8 channels, 4 operators per channel (M1, C1, M2, C2).
 * Clock: 3.579545 MHz, sample rate = clock / 64 = 55930 Hz.
 *
 * This is a software emulation targeting recognizable audio output.
 * Not cycle-accurate, but functionally correct for CPS1 music playback.
 *
 * Reference: YM2151 Application Manual, YMFM by Aaron Giles, jt51 by Jotego
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const YM_CLOCK = 3_579_545;
const YM_RATE = Math.floor(YM_CLOCK / 64); // 55930 Hz

/** Number of channels */
const NUM_CHANNELS = 8;

/** Number of operators per channel */
const NUM_OPERATORS = 4;

/** Sine table: 256 entries for quarter-wave (4.8 fixed-point log-sin attenuation) */
const SINE_TABLE_SIZE = 256;

/**
 * Envelope generator max attenuation (10-bit: 0x3FF = 1023).
 * 0 = max volume, 0x3FF = silence.
 */
const EG_MAX = 0x3FF;

/** TL shift: TL is 7-bit (0-127), shifted left 3 to get 10-bit envelope range */
const TL_SHIFT = 3;

/** EG counter step size — the real chip runs the EG at clock/3/32 */
const EG_TIMER_OVERFLOW = 3;

// ─── Envelope phases ─────────────────────────────────────────────────────────

const enum EnvPhase {
  Attack = 0,
  Decay1 = 1,
  Decay2 = 2,
  Release = 3,
  Off = 4,
}

// ─── Lookup tables ───────────────────────────────────────────────────────────

/**
 * Quarter-wave sine table: 256 entries of 4.8 fixed-point log-sin attenuation.
 * From the YMFM reference (Aaron Giles), which matches the YM2151 internal ROM.
 * Index i represents phase 0..PI/2. Output is attenuation (0 = full, higher = quieter).
 */
const sineTable = new Uint16Array([
  0x859,0x6c3,0x607,0x58b,0x52e,0x4e4,0x4a6,0x471,0x443,0x41a,0x3f5,0x3d3,0x3b5,0x398,0x37e,0x365,
  0x34e,0x339,0x324,0x311,0x2ff,0x2ed,0x2dc,0x2cd,0x2bd,0x2af,0x2a0,0x293,0x286,0x279,0x26d,0x261,
  0x256,0x24b,0x240,0x236,0x22c,0x222,0x218,0x20f,0x206,0x1fd,0x1f5,0x1ec,0x1e4,0x1dc,0x1d4,0x1cd,
  0x1c5,0x1be,0x1b7,0x1b0,0x1a9,0x1a2,0x19b,0x195,0x18f,0x188,0x182,0x17c,0x177,0x171,0x16b,0x166,
  0x160,0x15b,0x155,0x150,0x14b,0x146,0x141,0x13c,0x137,0x133,0x12e,0x129,0x125,0x121,0x11c,0x118,
  0x114,0x10f,0x10b,0x107,0x103,0x0ff,0x0fb,0x0f8,0x0f4,0x0f0,0x0ec,0x0e9,0x0e5,0x0e2,0x0de,0x0db,
  0x0d7,0x0d4,0x0d1,0x0cd,0x0ca,0x0c7,0x0c4,0x0c1,0x0be,0x0bb,0x0b8,0x0b5,0x0b2,0x0af,0x0ac,0x0a9,
  0x0a7,0x0a4,0x0a1,0x09f,0x09c,0x099,0x097,0x094,0x092,0x08f,0x08d,0x08a,0x088,0x086,0x083,0x081,
  0x07f,0x07d,0x07a,0x078,0x076,0x074,0x072,0x070,0x06e,0x06c,0x06a,0x068,0x066,0x064,0x062,0x060,
  0x05e,0x05c,0x05b,0x059,0x057,0x055,0x053,0x052,0x050,0x04e,0x04d,0x04b,0x04a,0x048,0x046,0x045,
  0x043,0x042,0x040,0x03f,0x03e,0x03c,0x03b,0x039,0x038,0x037,0x035,0x034,0x033,0x031,0x030,0x02f,
  0x02e,0x02d,0x02b,0x02a,0x029,0x028,0x027,0x026,0x025,0x024,0x023,0x022,0x021,0x020,0x01f,0x01e,
  0x01d,0x01c,0x01b,0x01a,0x019,0x018,0x017,0x017,0x016,0x015,0x014,0x014,0x013,0x012,0x011,0x011,
  0x010,0x00f,0x00f,0x00e,0x00d,0x00d,0x00c,0x00c,0x00b,0x00a,0x00a,0x009,0x009,0x008,0x008,0x007,
  0x007,0x007,0x006,0x006,0x005,0x005,0x005,0x004,0x004,0x004,0x003,0x003,0x003,0x002,0x002,0x002,
  0x002,0x001,0x001,0x001,0x001,0x001,0x001,0x001,0x000,0x000,0x000,0x000,0x000,0x000,0x000,0x000,
]);

/**
 * Exponential / power table: 256 entries.
 * Converts 8-bit fractional attenuation to 12-bit linear mantissa.
 * Formula: ((mantissa | 0x400) << 2) — from YMFM reference.
 * The caller then right-shifts by (attenuation >> 8) for the integer part.
 */
const expTable = new Uint16Array(256);

/**
 * DT1 (detune 1) table.
 * Indexed by [dt1][keycode >> 2], gives phase increment offset.
 * Based on the YM2151 manual tables.
 */
const dt1Table: number[][] = [];

/**
 * Envelope rate increment table — 64 entries, 8 sub-steps each.
 * Matches the YMFM s_increment_table nibble encoding.
 * Each entry is an array of 8 increment values for 8 counter sub-steps.
 */
const egIncTable: number[][] = [];

/**
 * Note frequency table: 16 entries (only 0-11 used, representing C# through C).
 * Values represent the base phase increment for octave 0.
 * These come from the YM2151 manual: frequency number for each note.
 */
const noteFreqTable = new Float64Array(16);

// Build lookup tables at module load time
function buildTables(): void {
  // ── Exponential table ──
  // Generate 256 entries matching the power curve.
  // Formula: exp2(-(i/256)) * 2048, with implied bit 0x400.
  // This matches YMFM: ((mantissa | 0x400) << 2).
  for (let i = 0; i < 256; i++) {
    // 2^(-i/256) scaled to 10-bit mantissa
    const mantissa = Math.round(Math.pow(2, 1 - i / 256) * 1024) - 1024;
    expTable[i] = ((mantissa | 0x400) << 2) >>> 0;
  }

  // ── DT1 table ──
  const dt1Base: number[][] = [
    // dt1 = 0: no detune
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    // dt1 = 1
    [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 8, 8],
    // dt1 = 2
    [1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9, 10, 11, 12, 13, 14, 16, 16, 16, 16],
    // dt1 = 3
    [2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 20, 22, 22, 22, 22],
  ];
  for (let d = 0; d < 8; d++) {
    const base = d < 4 ? dt1Base[d]! : dt1Base[d - 4]!;
    const sign = d < 4 ? 1 : -1;
    dt1Table[d] = new Array(32);
    for (let k = 0; k < 32; k++) {
      dt1Table[d]![k] = base[k]! * sign;
    }
  }

  // ── Envelope increment table ──
  // Matches the YMFM s_increment_table (nibble-packed 32-bit values).
  // Each 32-bit value encodes 8 nibbles: increments for 8 sub-counter steps.
  const egIncPacked: number[] = [
    0x00000000, 0x00000000, 0x10101010, 0x10101010, // rates 0-3
    0x10101010, 0x10101010, 0x11101110, 0x11101110, // rates 4-7
    0x10101010, 0x10111010, 0x11101110, 0x11111110, // rates 8-11
    0x10101010, 0x10111010, 0x11101110, 0x11111110, // rates 12-15
    0x10101010, 0x10111010, 0x11101110, 0x11111110, // rates 16-19
    0x10101010, 0x10111010, 0x11101110, 0x11111110, // rates 20-23
    0x10101010, 0x10111010, 0x11101110, 0x11111110, // rates 24-27
    0x10101010, 0x10111010, 0x11101110, 0x11111110, // rates 28-31
    0x10101010, 0x10111010, 0x11101110, 0x11111110, // rates 32-35
    0x10101010, 0x10111010, 0x11101110, 0x11111110, // rates 36-39
    0x10101010, 0x10111010, 0x11101110, 0x11111110, // rates 40-43
    0x10101010, 0x10111010, 0x11101110, 0x11111110, // rates 44-47
    0x11111111, 0x21112111, 0x21212121, 0x22212221, // rates 48-51
    0x22222222, 0x42224222, 0x42424242, 0x44424442, // rates 52-55
    0x44444444, 0x84448444, 0x84848484, 0x88848884, // rates 56-59
    0x88888888, 0x88888888, 0x88888888, 0x88888888, // rates 60-63
  ];
  for (let rate = 0; rate < 64; rate++) {
    const packed = egIncPacked[rate]!;
    const incs = new Array<number>(8);
    for (let step = 0; step < 8; step++) {
      incs[step] = (packed >> ((7 - step) * 4)) & 0x0F;
    }
    egIncTable[rate] = incs;
  }

  // ── Note frequency table ──
  // The YM2151 KC note field uses these note values:
  // 0=C#, 1=D, 2=D#, 4=E, 5=F, 6=F#, 8=G, 9=G#, 10=A, 12=A#, 13=B, 14=C
  const noteMap = [
    // index → semitone offset from C
    1, 2, 3, 3, 4, 5, 6, 6, 7, 8, 9, 9, 10, 11, 0, 0
  ];
  const c0Freq = 32.7032; // C0 frequency in Hz
  for (let i = 0; i < 16; i++) {
    const semitone = noteMap[i]!;
    const freq = c0Freq * Math.pow(2, semitone / 12);
    // Phase increment per sample for octave 0
    // Phase accumulator is 20-bit (1<<20 = one full cycle)
    noteFreqTable[i] = (freq / YM_RATE) * (1 << 20);
  }
}

buildTables();

// ─── Sine / Exp lookup functions (matching YMFM) ────────────────────────────

/**
 * Look up the absolute sine attenuation for a 10-bit phase input.
 * Uses the 256-entry quarter-wave table with mirroring.
 * Returns attenuation in 4.8 fixed-point (12-bit total).
 */
function absSinAttenuation(phase10: number): number {
  // Bits 8: mirror flag (second half of half-wave is mirrored)
  const mirror = phase10 & 0x100;
  // Low 8 bits: table index
  let idx = phase10 & 0xFF;
  if (mirror) {
    idx = 0xFF - idx; // mirror second quarter
  }
  return sineTable[idx]!;
}

/**
 * Convert log-attenuation to linear volume.
 * Input: total attenuation in 4.8 fixed-point format.
 * Output: 13-bit unsigned linear value (0..~8191).
 */
function attenuationToVolume(attenuation: number): number {
  // Fractional part (low 8 bits) indexes the exp table
  const frac = attenuation & 0xFF;
  // Integer part (high bits) determines the right-shift
  const shift = attenuation >> 8;
  // Look up mantissa and shift by integer part
  return expTable[frac]! >> shift;
}

// ─── MUL (frequency multiplier) ─────────────────────────────────────────────
// MUL=0 means x0.5, MUL=1-15 means x1 through x15
function getMulFactor(mul: number): number {
  return mul === 0 ? 0.5 : mul;
}

// ─── Operator state ──────────────────────────────────────────────────────────

class Operator {
  // Phase
  phase: number = 0;          // 20-bit phase accumulator
  phaseInc: number = 0;       // phase increment per sample

  // Envelope (integer, 10-bit: 0 = max vol, 0x3FF = silence)
  envPhase: EnvPhase = EnvPhase.Off;
  envLevel: number = EG_MAX;
  totalLevel: number = 0;       // TL (0-127) << 3 = 0-1016

  // ADSR rates (raw register values)
  ar: number = 0;   // attack rate (0-31)
  d1r: number = 0;  // decay 1 rate (0-31)
  d2r: number = 0;  // decay 2 rate (0-31)
  rr: number = 0;   // release rate (0-15)
  d1l: number = 0;  // decay 1 level (0-15)

  // Effective rates (computed from raw + key scale, 0-63)
  effAR: number = 0;
  effD1R: number = 0;
  effD2R: number = 0;
  effRR: number = 0;

  // D1L converted to envelope units (0-1023)
  d1lLevel: number = 0;

  // Key scale
  ks: number = 0;

  // Detune
  dt1: number = 0;   // 0-7
  dt2: number = 0;   // 0-3

  // Multiplier
  mul: number = 0;   // 0-15

  // AMS enable
  amsEn: boolean = false;

  // Key on state
  keyOn: boolean = false;

  // Feedback (only for operator M1, stored per-channel but applied per-op)
  feedbackShift: number = 0;
  feedback0: number = 0;
  feedback1: number = 0;

  // Envelope counter for rate-dependent stepping
  egCounter: number = 0;

  /**
   * Recompute effective rates from raw ADSR rates + key scale + key code.
   */
  computeRates(keyCode: number): void {
    const ksShift = keyCode >> (3 - this.ks);
    this.effAR = Math.min(63, this.ar > 0 ? (this.ar * 2 + 1) + ksShift : 0);
    this.effD1R = Math.min(63, this.d1r > 0 ? (this.d1r * 2 + 1) + ksShift : 0);
    this.effD2R = Math.min(63, this.d2r > 0 ? (this.d2r * 2 + 1) + ksShift : 0);
    this.effRR = Math.min(63, (this.rr * 4 + 2) + ksShift);

    // D1L -> envelope level threshold
    // D1L=0 => 0, D1L=1-14 => d1l << 5 (32-step), D1L=15 => max attenuation
    this.d1lLevel = this.d1l === 15 ? EG_MAX : (this.d1l << 5);
  }

  /**
   * Compute phase increment from channel key code, key fraction, detune and MUL.
   */
  computePhaseInc(keyCode: number, keyFraction: number): void {
    const octave = (keyCode >> 4) & 0x07;
    const note = keyCode & 0x0F;

    // Base phase increment from note table (octave 0)
    let baseInc = noteFreqTable[note & 0x0F]!;

    // Shift by octave
    baseInc *= (1 << octave);

    // Apply key fraction (KF is 6-bit, represents 1/64 of a semitone)
    if (keyFraction > 0) {
      baseInc *= Math.pow(2, keyFraction / (64 * 12));
    }

    // Apply DT1
    const dt1Idx = this.dt1 & 7;
    if (dt1Idx !== 0) {
      const kcDiv = Math.min(31, keyCode >> 1);
      const detune = dt1Table[dt1Idx]![kcDiv]!;
      baseInc += detune;
    }

    // Apply MUL
    baseInc *= getMulFactor(this.mul);

    this.phaseInc = Math.floor(baseInc);
  }

  /**
   * Trigger key on: reset phase, start attack.
   */
  keyOnEvent(): void {
    if (!this.keyOn) {
      this.keyOn = true;
      this.phase = 0;
      this.envPhase = EnvPhase.Attack;
      // Don't reset envLevel -- real YM2151 starts attack from current level
    }
  }

  /**
   * Trigger key off: enter release phase.
   */
  keyOffEvent(): void {
    if (this.keyOn) {
      this.keyOn = false;
      this.envPhase = EnvPhase.Release;
    }
  }

  /**
   * Advance envelope by one sample.
   * Uses the YMFM-style rate-dependent counter with the increment table.
   */
  updateEnvelope(): void {
    // Advance the global sub-step counter (wraps at 8)
    this.egCounter = (this.egCounter + 1) & 7;

    switch (this.envPhase) {
      case EnvPhase.Attack: {
        if (this.effAR >= 62) {
          // Instant attack
          this.envLevel = 0;
          this.envPhase = EnvPhase.Decay1;
        } else if (this.effAR > 0) {
          const increment = this._getIncrement(this.effAR);
          if (increment > 0) {
            // YMFM attack formula: attenuation += (~attenuation * increment) >> 4
            // This is exponential: faster when far from 0, slows as it approaches 0
            this.envLevel += ((~this.envLevel * increment) >> 4);
            if (this.envLevel <= 0) {
              this.envLevel = 0;
              this.envPhase = EnvPhase.Decay1;
            }
          }
        }
        break;
      }
      case EnvPhase.Decay1: {
        if (this.effD1R > 0) {
          const increment = this._getIncrement(this.effD1R);
          this.envLevel += increment;
          if (this.envLevel >= this.d1lLevel) {
            this.envLevel = this.d1lLevel;
            this.envPhase = EnvPhase.Decay2;
          }
        } else {
          // D1R = 0 means no decay, transition immediately to D2
          this.envPhase = EnvPhase.Decay2;
        }
        break;
      }
      case EnvPhase.Decay2: {
        if (this.effD2R > 0) {
          const increment = this._getIncrement(this.effD2R);
          this.envLevel += increment;
          if (this.envLevel >= EG_MAX) {
            this.envLevel = EG_MAX;
            this.envPhase = EnvPhase.Off;
          }
        }
        // D2R = 0 means sustain forever at D1L level
        break;
      }
      case EnvPhase.Release: {
        if (this.effRR > 0) {
          const increment = this._getIncrement(this.effRR);
          this.envLevel += increment;
          if (this.envLevel >= EG_MAX) {
            this.envLevel = EG_MAX;
            this.envPhase = EnvPhase.Off;
          }
        }
        break;
      }
      case EnvPhase.Off:
        this.envLevel = EG_MAX;
        break;
    }
  }

  /**
   * Get the envelope increment for the current sub-step, using the rate table.
   * The rate determines which row in egIncTable to use, and the counter
   * sub-step determines which column.
   *
   * For rates 0-47: the increment is applied every N samples (determined by shift).
   * For rates 48-63: the increment value itself scales up.
   */
  private _getIncrement(rate: number): number {
    if (rate <= 0) return 0;

    // Rates < 48 use a shift to slow down the counter
    // Rates >= 48 use direct increment scaling
    const effectiveRate = Math.min(63, rate);

    // The shift determines how often we actually apply an increment.
    // For low rates, we only increment every 2^shift samples.
    const shift = Math.max(0, 13 - (effectiveRate >> 2));
    const counterMask = (1 << shift) - 1;

    // Only apply increment when counter aligns with the shift
    if (shift > 0 && (this.egCounter & counterMask) !== 0) {
      return 0;
    }

    // Select which of the 8 sub-step increments to use
    const subStep = shift > 0
      ? (this.egCounter >> shift) & 7
      : this.egCounter & 7;

    return egIncTable[effectiveRate]![subStep]!;
  }

  /**
   * Calculate operator output.
   * @param modulation Phase modulation input from other operators (signed)
   * @param lfoAm LFO amplitude modulation value
   * @returns Signed output (14-bit range)
   */
  calcOutput(modulation: number, lfoAm: number): number {
    if (this.envPhase === EnvPhase.Off) return 0;

    // Phase: 20-bit accumulator, use top 10 bits + modulation
    const rawPhase = ((this.phase >> 10) + modulation) & 0x3FF;

    // Get log-sin attenuation from quarter-wave table
    // Bit 9 = sign (second half-wave is negative)
    // Bits 0-8 = quarter-wave lookup input
    const sinAttenuation = absSinAttenuation(rawPhase & 0x1FF);

    // Build total envelope attenuation (10-bit)
    let envTotal = this.envLevel + this.totalLevel;

    // Add LFO AM if enabled
    if (this.amsEn) {
      envTotal += lfoAm;
    }

    // Clamp to 10-bit range
    if (envTotal > EG_MAX) envTotal = EG_MAX;

    // Combine sine attenuation (4.8 format) with envelope (shifted to 4.8)
    // Envelope is 10-bit, we treat it as 2.8 format (shift left 0 since
    // the sine table is already in 4.8 format and envelope represents
    // the same log scale)
    const totalAttenuation = sinAttenuation + (envTotal << 2);

    // If total attenuation is too high, output silence
    // Max useful attenuation: ~4096 (beyond that, volume is effectively 0)
    if (totalAttenuation >= 0x1000) return 0;

    // Convert from log to linear via exp table
    const linear = attenuationToVolume(totalAttenuation);

    // Sign from phase: bit 9 of the 10-bit phase determines sign
    const sign = (rawPhase & 0x200) ? -1 : 1;

    // linear is 13-bit (0..~8191), shift right to get 14-bit signed range
    return sign * (linear >> 2);
  }

  /**
   * Advance phase by one sample.
   */
  advancePhase(): void {
    this.phase = (this.phase + this.phaseInc) & 0xFFFFF; // 20-bit wrap
  }
}

// ─── Channel state ───────────────────────────────────────────────────────────

class Channel {
  /** 4 operators: M1 (idx 0), C1 (idx 1), M2 (idx 2), C2 (idx 3) */
  ops: Operator[];

  // Key code and fraction
  keyCode: number = 0;    // 7-bit: octave(3) | note(4)
  keyFraction: number = 0; // 6-bit

  // Connection algorithm (0-7)
  algorithm: number = 0;

  // Feedback level for M1 (0-7, 0=off)
  feedback: number = 0;

  // Stereo output: left and right enable
  leftEnable: boolean = true;
  rightEnable: boolean = true;

  // PMS / AMS
  pms: number = 0;
  ams: number = 0;

  constructor() {
    this.ops = [];
    for (let i = 0; i < NUM_OPERATORS; i++) {
      this.ops.push(new Operator());
    }
  }

  /**
   * Recompute all operator phase increments and rates.
   */
  updateFrequency(): void {
    for (let i = 0; i < NUM_OPERATORS; i++) {
      this.ops[i]!.computePhaseInc(this.keyCode, this.keyFraction);
      this.ops[i]!.computeRates(this.keyCode);
    }
  }

  /**
   * Generate one sample for this channel using the selected algorithm.
   *
   * YMFM operator naming: O1=M1, O2=C1, O3=M2, O4=C2
   * (our ops[0]=M1, ops[1]=C1, ops[2]=M2, ops[3]=C2)
   *
   * Algorithm connections (from YMFM reference):
   *   0: M1->C1->M2->C2          (1 carrier: C2)
   *   1: (M1+C1)->M2->C2         (1 carrier: C2)
   *   2: (M1+(C1->M2))->C2       (1 carrier: C2)
   *   3: ((M1->C1)+M2)->C2       (1 carrier: C2)
   *   4: (M1->C1)+(M2->C2)       (2 carriers: C1,C2)
   *   5: M1->(C1+M2+C2)          (3 carriers: C1,M2,C2)
   *   6: (M1->C1)+M2+C2          (3 carriers: C1,M2,C2)
   *   7: M1+C1+M2+C2             (4 carriers: all)
   */
  generateSample(lfoPhase: number, lfoAm: number): number {
    const m1 = this.ops[0]!;
    const c1 = this.ops[1]!;
    const m2 = this.ops[2]!;
    const c2 = this.ops[3]!;

    // AMS depth mapping: 0=0dB, 1=1.4dB, 2=5.9dB, 3=11.8dB
    const amsDepth = [0, 32, 128, 256][this.ams]!;
    const amValue = Math.floor((lfoAm * amsDepth) >> 8);

    // Feedback on M1: average of last two outputs, shifted by feedback amount
    let m1Mod = 0;
    if (this.feedback > 0) {
      m1Mod = (m1.feedback0 + m1.feedback1) >> (10 - this.feedback);
    }

    // Calculate M1 output (always first, with self-feedback)
    const m1Out = m1.calcOutput(m1Mod, amValue);

    // Store M1 feedback
    m1.feedback1 = m1.feedback0;
    m1.feedback0 = m1Out >> 1;

    let output = 0;

    switch (this.algorithm) {
      case 0: {
        // M1->C1->M2->C2 (serial chain)
        // Only C2 is carrier
        const c1Out = c1.calcOutput(m1Out >> 1, amValue);
        const m2Out = m2.calcOutput(c1Out >> 1, amValue);
        output = c2.calcOutput(m2Out >> 1, amValue);
        break;
      }
      case 1: {
        // (M1+C1)->M2->C2
        const c1Out = c1.calcOutput(0, amValue);
        const m2Out = m2.calcOutput((m1Out + c1Out) >> 1, amValue);
        output = c2.calcOutput(m2Out >> 1, amValue);
        break;
      }
      case 2: {
        // (M1+(C1->M2))->C2
        const c1Out = c1.calcOutput(0, amValue);
        const m2Out = m2.calcOutput(c1Out >> 1, amValue);
        output = c2.calcOutput((m1Out + m2Out) >> 1, amValue);
        break;
      }
      case 3: {
        // ((M1->C1)+M2)->C2
        const c1Out = c1.calcOutput(m1Out >> 1, amValue);
        const m2Out = m2.calcOutput(0, amValue);
        output = c2.calcOutput((c1Out + m2Out) >> 1, amValue);
        break;
      }
      case 4: {
        // (M1->C1) + (M2->C2), two parallel pairs
        // 2 carriers: C1 and C2
        const c1Out = c1.calcOutput(m1Out >> 1, amValue);
        const m2Out = m2.calcOutput(0, amValue);
        const c2Out = c2.calcOutput(m2Out >> 1, amValue);
        output = (c1Out + c2Out) >> 1;
        break;
      }
      case 5: {
        // M1 feeds all three: C1, M2, C2
        // 3 carriers: C1, M2, C2
        const mod = m1Out >> 1;
        const c1Out = c1.calcOutput(mod, amValue);
        const m2Out = m2.calcOutput(mod, amValue);
        const c2Out = c2.calcOutput(mod, amValue);
        output = (c1Out + m2Out + c2Out) / 3;
        break;
      }
      case 6: {
        // M1->C1, M2 and C2 independent
        // 3 carriers: C1, M2, C2
        const c1Out = c1.calcOutput(m1Out >> 1, amValue);
        const m2Out = m2.calcOutput(0, amValue);
        const c2Out = c2.calcOutput(0, amValue);
        output = (c1Out + m2Out + c2Out) / 3;
        break;
      }
      case 7: {
        // All four independent (no modulation except M1 self-feedback)
        // 4 carriers: M1, C1, M2, C2
        const c1Out = c1.calcOutput(0, amValue);
        const m2Out = m2.calcOutput(0, amValue);
        const c2Out = c2.calcOutput(0, amValue);
        output = (m1Out + c1Out + m2Out + c2Out) >> 2;
        break;
      }
    }

    // Advance all operator phases and envelopes
    m1.advancePhase();
    c1.advancePhase();
    m2.advancePhase();
    c2.advancePhase();

    m1.updateEnvelope();
    c1.updateEnvelope();
    m2.updateEnvelope();
    c2.updateEnvelope();

    return output;
  }
}

// ─── LFO ─────────────────────────────────────────────────────────────────────

class LFO {
  phase: number = 0;
  phaseInc: number = 0;
  waveform: number = 0; // 0=saw, 1=square, 2=triangle, 3=noise

  amd: number = 0; // amplitude modulation depth (0-127)
  pmd: number = 0; // phase modulation depth (0-127)

  // Noise LFSR for noise waveform
  noiseState: number = 1;

  /**
   * Set LFO frequency from register value.
   * The YM2151 LFO frequency table maps 0-255 to ~0.008Hz to ~32.6Hz.
   */
  setFrequency(value: number): void {
    if (value === 0) {
      this.phaseInc = 0;
    } else {
      const freqHz = 0.008 * Math.pow(2, value / 32);
      this.phaseInc = (freqHz / YM_RATE) * (1 << 20);
    }
  }

  /**
   * Advance LFO and return [phaseModulation, amplitudeModulation].
   */
  advance(): [number, number] {
    this.phase = (this.phase + this.phaseInc) & 0xFFFFF;

    const phaseNorm = this.phase / (1 << 20); // 0..1

    let waveVal: number; // -1..+1 for phase mod
    let amWaveVal: number; // 0..1 for amplitude mod

    switch (this.waveform) {
      case 0: // Sawtooth
        waveVal = 2 * phaseNorm - 1;
        amWaveVal = phaseNorm;
        break;
      case 1: // Square
        waveVal = phaseNorm < 0.5 ? 1 : -1;
        amWaveVal = phaseNorm < 0.5 ? 1 : 0;
        break;
      case 2: // Triangle
        waveVal = phaseNorm < 0.5
          ? 4 * phaseNorm - 1
          : 3 - 4 * phaseNorm;
        amWaveVal = phaseNorm < 0.5
          ? 2 * phaseNorm
          : 2 - 2 * phaseNorm;
        break;
      case 3: // Noise
        this.noiseState ^= (this.noiseState << 13);
        this.noiseState ^= (this.noiseState >> 17);
        this.noiseState ^= (this.noiseState << 5);
        waveVal = (this.noiseState & 0xFFFF) / 32768 - 1;
        amWaveVal = Math.abs(waveVal);
        break;
      default:
        waveVal = Math.sin(2 * Math.PI * phaseNorm);
        amWaveVal = (waveVal + 1) / 2;
    }

    const phaseMod = Math.floor(waveVal * this.pmd);
    const ampMod = Math.floor(amWaveVal * this.amd * 4); // scale to envelope units

    return [phaseMod, ampMod];
  }

  reset(): void {
    this.phase = 0;
  }
}

// ─── Noise generator ─────────────────────────────────────────────────────────

class NoiseGenerator {
  enabled: boolean = false;
  frequency: number = 0; // 5-bit (0-31)
  lfsr: number = 0x7FFF; // 15-bit LFSR
  counter: number = 0;
  output: number = 0;

  /**
   * Advance noise generator by one sample.
   * Returns noise output as signed value.
   */
  advance(): number {
    if (!this.enabled) return 0;

    this.counter++;
    const period = (32 - this.frequency) * 16;
    if (this.counter >= period) {
      this.counter = 0;
      const bit = ((this.lfsr >> 0) ^ (this.lfsr >> 1)) & 1;
      this.lfsr = ((this.lfsr >> 1) | (bit << 14)) & 0x7FFF;
      this.output = (this.lfsr & 1) ? 2047 : -2047;
    }
    return this.output;
  }
}

// ─── Timer ───────────────────────────────────────────────────────────────────

class Timer {
  period: number = 0;          // in samples
  counter: number = 0;
  enabled: boolean = false;
  overflow: boolean = false;   // overflow flag
  irqEnable: boolean = false;  // IRQ mask

  /**
   * Advance timer by one sample.
   * @returns true if timer overflowed this sample.
   */
  advance(): boolean {
    if (!this.enabled) return false;

    this.counter++;
    if (this.counter >= this.period) {
      this.counter = 0;
      this.overflow = true;
      return true;
    }
    return false;
  }

  reset(): void {
    this.counter = 0;
    this.overflow = false;
  }
}

// ─── YM2151 main class ──────────────────────────────────────────────────────

export class YM2151 {
  private channels: Channel[];
  private lfo: LFO;
  private noise: NoiseGenerator;
  private timerA: Timer;
  private timerB: Timer;

  // Register state
  private registers: Uint8Array;
  private selectedRegister: number;

  // Timer raw values
  private timerAHigh: number;
  private timerALow: number;
  private timerBValue: number;

  // Timer callback (for Z80 IRQ assert)
  private timerCallback: ((timerIndex: number) => void) | null;

  // IRQ line clear callback
  private irqClearCallback: (() => void) | null;

  // Busy flag
  private busyCycles: number;

  // CT1/CT2 output pins
  private ct1: boolean;
  private ct2: boolean;

  // When true, generateSamples() skips timer advancement
  private _externalTimerMode: boolean;

  constructor() {
    this.channels = [];
    for (let i = 0; i < NUM_CHANNELS; i++) {
      this.channels.push(new Channel());
    }
    this.lfo = new LFO();
    this.noise = new NoiseGenerator();
    this.timerA = new Timer();
    this.timerB = new Timer();

    this.registers = new Uint8Array(256);
    this.selectedRegister = 0;
    this.timerAHigh = 0;
    this.timerALow = 0;
    this.timerBValue = 0;
    this.timerCallback = null;
    this.irqClearCallback = null;
    this.busyCycles = 0;
    this.ct1 = false;
    this.ct2 = false;
    this._externalTimerMode = false;
  }

  // ── Public interface ─────────────────────────────────────────────────────

  writeAddress(value: number): void {
    this.selectedRegister = value & 0xFF;
  }

  writeData(value: number): void {
    value = value & 0xFF;
    const reg = this.selectedRegister;
    this.registers[reg] = value;
    this.busyCycles = 64;

    this.writeRegister(reg, value);
  }

  readStatus(): number {
    let status = 0;
    if (this.busyCycles > 0) status |= 0x80;
    if (this.timerA.overflow && this.timerA.irqEnable) status |= 0x01;
    if (this.timerB.overflow && this.timerB.irqEnable) status |= 0x02;
    return status;
  }

  setExternalTimerMode(enabled: boolean): void {
    this._externalTimerMode = enabled;
  }

  /**
   * Generate stereo audio samples.
   */
  generateSamples(bufferL: Float32Array, bufferR: Float32Array, numSamples: number): void {
    for (let s = 0; s < numSamples; s++) {
      // Advance LFO
      const [lfoPM, lfoAM] = this.lfo.advance();

      // Advance timers and busy counter only if NOT in external timer mode
      if (!this._externalTimerMode) {
        if (this.busyCycles > 0) this.busyCycles--;

        if (this.timerA.advance()) {
          if (this.timerA.irqEnable && this.timerCallback !== null) {
            this.timerCallback(0);
          }
        }
        if (this.timerB.advance()) {
          if (this.timerB.irqEnable && this.timerCallback !== null) {
            this.timerCallback(1);
          }
        }
      }

      // Advance noise
      const noiseOut = this.noise.advance();

      // Mix all channels
      let mixL = 0;
      let mixR = 0;

      for (let ch = 0; ch < NUM_CHANNELS; ch++) {
        const channel = this.channels[ch]!;
        let sample: number;

        // Channel 7 can use noise instead of normal output
        if (ch === 7 && this.noise.enabled) {
          sample = channel.generateSample(lfoPM, lfoAM);
          sample = (sample + noiseOut) >> 1;
        } else {
          sample = channel.generateSample(lfoPM, lfoAM);
        }

        if (channel.leftEnable) mixL += sample;
        if (channel.rightEnable) mixR += sample;
      }

      // Normalize to float [-1, 1]
      // Each channel outputs ~14-bit signed (~+/-2048 typical).
      // 8 channels max sum ~+/-16384. Use 1/16384 for headroom.
      const scale = 1.0 / 16384;
      bufferL[s] = mixL * scale;
      bufferR[s] = mixR * scale;
    }
  }

  setTimerCallback(cb: (timerIndex: number) => void): void {
    this.timerCallback = cb;
  }

  setIrqClearCallback(cb: () => void): void {
    this.irqClearCallback = cb;
  }

  tickTimers(): boolean {
    let irq = false;

    if (this.timerA.advance()) {
      if (this.timerA.irqEnable) {
        irq = true;
        if (this.timerCallback !== null) {
          this.timerCallback(0);
        }
      }
    }
    if (this.timerB.advance()) {
      if (this.timerB.irqEnable) {
        irq = true;
        if (this.timerCallback !== null) {
          this.timerCallback(1);
        }
      }
    }

    if (this.busyCycles > 0) this.busyCycles--;

    return irq;
  }

  getSampleRate(): number {
    return YM_RATE;
  }

  reset(): void {
    this.registers.fill(0);
    this.selectedRegister = 0;
    this.busyCycles = 0;
    this.timerAHigh = 0;
    this.timerALow = 0;
    this.timerBValue = 0;
    this.ct1 = false;
    this.ct2 = false;

    this.lfo.reset();
    this.lfo.amd = 0;
    this.lfo.pmd = 0;
    this.lfo.waveform = 0;
    this.lfo.phaseInc = 0;

    this.noise.enabled = false;
    this.noise.frequency = 0;
    this.noise.lfsr = 0x7FFF;

    this.timerA.reset();
    this.timerA.enabled = false;
    this.timerA.irqEnable = false;
    this.timerB.reset();
    this.timerB.enabled = false;
    this.timerB.irqEnable = false;

    for (let ch = 0; ch < NUM_CHANNELS; ch++) {
      const channel = this.channels[ch]!;
      channel.algorithm = 0;
      channel.feedback = 0;
      channel.keyCode = 0;
      channel.keyFraction = 0;
      channel.leftEnable = true;
      channel.rightEnable = true;
      channel.pms = 0;
      channel.ams = 0;

      for (let op = 0; op < NUM_OPERATORS; op++) {
        const o = channel.ops[op]!;
        o.phase = 0;
        o.phaseInc = 0;
        o.envPhase = EnvPhase.Off;
        o.envLevel = EG_MAX;
        o.totalLevel = EG_MAX;
        o.ar = 0;
        o.d1r = 0;
        o.d2r = 0;
        o.rr = 0;
        o.d1l = 0;
        o.ks = 0;
        o.dt1 = 0;
        o.dt2 = 0;
        o.mul = 0;
        o.amsEn = false;
        o.keyOn = false;
        o.feedbackShift = 0;
        o.feedback0 = 0;
        o.feedback1 = 0;
        o.egCounter = 0;
      }
    }
  }

  // ── Register write dispatch ──────────────────────────────────────────────

  private getOperatorIndex(reg: number): { channel: number; operator: number } | null {
    const offset = reg & 0x1F;
    const channel = offset & 0x07;
    const opSlot = (offset >> 3) & 0x03;

    // Map YM2151 slot order to our internal order:
    // Slot 0 = M1 (ops[0]), Slot 1 = M2 (ops[2]), Slot 2 = C1 (ops[1]), Slot 3 = C2 (ops[3])
    const slotToOp = [0, 2, 1, 3];
    const operator = slotToOp[opSlot]!;

    if (channel >= NUM_CHANNELS) return null;
    return { channel, operator };
  }

  private writeRegister(reg: number, value: number): void {
    // ── Global registers (0x00-0x1F) ─────────────────────────────────────

    if (reg === 0x01) {
      if (value & 0x02) {
        this.lfo.reset();
      }
      return;
    }

    if (reg === 0x08) {
      // Key On/Off
      const ch = value & 0x07;
      const slotMask = (value >> 3) & 0x0F;
      const channel = this.channels[ch]!;

      // Slot mapping: bit 0=M1, bit 1=C1, bit 2=M2, bit 3=C2
      const slotToOp = [0, 1, 2, 3];
      for (let slot = 0; slot < 4; slot++) {
        const op = channel.ops[slotToOp[slot]!]!;
        if (slotMask & (1 << slot)) {
          op.keyOnEvent();
        } else {
          op.keyOffEvent();
        }
      }
      return;
    }

    if (reg === 0x0F) {
      this.noise.enabled = (value & 0x80) !== 0;
      this.noise.frequency = value & 0x1F;
      return;
    }

    if (reg === 0x10) {
      this.timerAHigh = value;
      this.updateTimerA();
      return;
    }

    if (reg === 0x11) {
      this.timerALow = value & 0x03;
      this.updateTimerA();
      return;
    }

    if (reg === 0x12) {
      this.timerBValue = value;
      this.updateTimerB();
      return;
    }

    if (reg === 0x14) {
      this.timerA.irqEnable = (value & 0x10) !== 0;
      this.timerB.irqEnable = (value & 0x20) !== 0;
      this.timerA.enabled = (value & 0x04) !== 0;
      this.timerB.enabled = (value & 0x08) !== 0;

      if (value & 0x01) {
        this.timerA.overflow = false;
      }
      if (value & 0x02) {
        this.timerB.overflow = false;
      }

      if (!this.timerA.overflow && !this.timerB.overflow) {
        if (this.irqClearCallback !== null) {
          this.irqClearCallback();
        }
      }
      return;
    }

    if (reg === 0x18) {
      this.lfo.setFrequency(value);
      return;
    }

    if (reg === 0x19) {
      if (value & 0x80) {
        this.lfo.pmd = value & 0x7F;
      } else {
        this.lfo.amd = value & 0x7F;
      }
      return;
    }

    if (reg === 0x1B) {
      this.ct1 = (value & 0x40) !== 0;
      this.ct2 = (value & 0x80) !== 0;
      this.lfo.waveform = value & 0x03;
      return;
    }

    // ── Per-channel registers (0x20-0x3F) ────────────────────────────────

    if (reg >= 0x20 && reg <= 0x27) {
      const ch = reg & 0x07;
      const channel = this.channels[ch]!;
      channel.rightEnable = (value & 0x80) !== 0;
      channel.leftEnable = (value & 0x40) !== 0;
      channel.feedback = (value >> 3) & 0x07;
      channel.algorithm = value & 0x07;
      return;
    }

    if (reg >= 0x28 && reg <= 0x2F) {
      const ch = reg & 0x07;
      const channel = this.channels[ch]!;
      channel.keyCode = value & 0x7F;
      channel.updateFrequency();
      return;
    }

    if (reg >= 0x30 && reg <= 0x37) {
      const ch = reg & 0x07;
      const channel = this.channels[ch]!;
      channel.keyFraction = (value >> 2) & 0x3F;
      channel.updateFrequency();
      return;
    }

    if (reg >= 0x38 && reg <= 0x3F) {
      const ch = reg & 0x07;
      const channel = this.channels[ch]!;
      channel.pms = (value >> 4) & 0x07;
      channel.ams = value & 0x03;
      return;
    }

    // ── Per-operator registers (0x40-0xFF) ───────────────────────────────

    if (reg >= 0x40 && reg <= 0x5F) {
      const idx = this.getOperatorIndex(reg);
      if (idx === null) return;
      const op = this.channels[idx.channel]!.ops[idx.operator]!;
      op.dt1 = (value >> 4) & 0x07;
      op.mul = value & 0x0F;
      this.channels[idx.channel]!.updateFrequency();
      return;
    }

    if (reg >= 0x60 && reg <= 0x7F) {
      const idx = this.getOperatorIndex(reg);
      if (idx === null) return;
      const op = this.channels[idx.channel]!.ops[idx.operator]!;
      op.totalLevel = (value & 0x7F) << TL_SHIFT;
      return;
    }

    if (reg >= 0x80 && reg <= 0x9F) {
      const idx = this.getOperatorIndex(reg);
      if (idx === null) return;
      const op = this.channels[idx.channel]!.ops[idx.operator]!;
      op.ks = (value >> 6) & 0x03;
      op.ar = value & 0x1F;
      op.computeRates(this.channels[idx.channel]!.keyCode);
      return;
    }

    if (reg >= 0xA0 && reg <= 0xBF) {
      const idx = this.getOperatorIndex(reg);
      if (idx === null) return;
      const op = this.channels[idx.channel]!.ops[idx.operator]!;
      op.amsEn = (value & 0x80) !== 0;
      op.d1r = value & 0x1F;
      op.computeRates(this.channels[idx.channel]!.keyCode);
      return;
    }

    if (reg >= 0xC0 && reg <= 0xDF) {
      const idx = this.getOperatorIndex(reg);
      if (idx === null) return;
      const op = this.channels[idx.channel]!.ops[idx.operator]!;
      op.dt2 = (value >> 6) & 0x03;
      op.d2r = value & 0x1F;
      op.computeRates(this.channels[idx.channel]!.keyCode);
      return;
    }

    if (reg >= 0xE0 && reg <= 0xFF) {
      const idx = this.getOperatorIndex(reg);
      if (idx === null) return;
      const op = this.channels[idx.channel]!.ops[idx.operator]!;
      op.d1l = (value >> 4) & 0x0F;
      op.rr = value & 0x0F;
      op.computeRates(this.channels[idx.channel]!.keyCode);
      return;
    }
  }

  // ── Timer period computation ───────────────────────────────────────────

  private updateTimerA(): void {
    const ta = (this.timerAHigh << 2) | this.timerALow;
    this.timerA.period = Math.max(1, 1024 - ta);
  }

  private updateTimerB(): void {
    this.timerB.period = Math.max(1, 16 * (256 - this.timerBValue));
  }
}
