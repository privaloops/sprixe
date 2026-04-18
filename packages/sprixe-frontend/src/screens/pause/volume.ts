/**
 * VolumeControl — pause-menu volume slider + mute toggle (§2.6 + §2.8).
 *
 * Backed by SettingsStore so the value survives resume/quit/reload.
 * Mute is tracked as "last non-zero volume before mute", so
 * toggleMute() zero → restore returns to exactly the previous level,
 * even if the user nudged the slider to 0 manually.
 *
 * The component doesn't own the AudioContext — callers subscribe to
 * onChange and pipe getGainValue() into their GainNode.gain.value.
 * Keeps the module testable without a real Web Audio graph.
 */

import type { SettingsStore } from "../settings/settings-store";

type Listener = (value: number) => void;

export interface VolumeControlOptions {
  settings: SettingsStore;
}

export class VolumeControl {
  private readonly settings: SettingsStore;
  private beforeMute: number | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(options: VolumeControlOptions) {
    this.settings = options.settings;
  }

  /** Current volume 0..100 (reflects the SettingsStore). */
  getVolume(): number {
    return this.settings.get().audio.masterVolume;
  }

  /** Volume mapped to a GainNode-friendly 0..1 float. */
  getGainValue(): number {
    return this.getVolume() / 100;
  }

  /** Clamped to [0, 100]; persisted; fires onChange. */
  setVolume(value: number): void {
    const clamped = clamp(Math.round(value), 0, 100);
    if (clamped === this.getVolume()) return;
    // Manual slide to non-zero clears the "mute memory" — the user
    // explicitly chose this level, so unmute() would have nothing
    // meaningful to restore.
    if (clamped > 0) this.beforeMute = null;
    this.settings.update({ audio: { masterVolume: clamped } });
    this.emit();
  }

  isMuted(): boolean {
    return this.getVolume() === 0 && this.beforeMute !== null;
  }

  mute(): void {
    const current = this.getVolume();
    if (current === 0) return; // already silent; don't overwrite beforeMute with 0
    this.beforeMute = current;
    this.settings.update({ audio: { masterVolume: 0 } });
    this.emit();
  }

  unmute(): void {
    if (this.beforeMute === null) return;
    const restore = this.beforeMute;
    this.beforeMute = null;
    this.settings.update({ audio: { masterVolume: restore } });
    this.emit();
  }

  toggleMute(): void {
    if (this.isMuted()) this.unmute();
    else this.mute();
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(): void {
    const value = this.getVolume();
    for (const l of this.listeners) l(value);
  }
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(Math.max(n, min), max);
}
