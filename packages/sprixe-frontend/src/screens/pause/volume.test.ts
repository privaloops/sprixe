import { describe, it, expect, beforeEach, vi } from "vitest";
import { VolumeControl } from "./volume";
import { SettingsStore } from "../settings/settings-store";

describe("VolumeControl", () => {
  let settings: SettingsStore;
  let vol: VolumeControl;

  beforeEach(() => {
    localStorage.clear();
    settings = new SettingsStore();
    vol = new VolumeControl({ settings });
  });

  describe("linear mapping 0..100 → 0..1", () => {
    it("default 80 → 0.8 gain", () => {
      expect(vol.getVolume()).toBe(80);
      expect(vol.getGainValue()).toBe(0.8);
    });

    it("setVolume(25) → gain 0.25", () => {
      vol.setVolume(25);
      expect(vol.getGainValue()).toBe(0.25);
    });

    it("clamps out-of-range inputs", () => {
      vol.setVolume(150);
      expect(vol.getVolume()).toBe(100);
      vol.setVolume(-5);
      expect(vol.getVolume()).toBe(0);
    });

    it("rounds fractional inputs", () => {
      vol.setVolume(42.7);
      expect(vol.getVolume()).toBe(43);
    });
  });

  describe("persistence via SettingsStore", () => {
    it("setVolume writes through to SettingsStore (and therefore localStorage)", () => {
      vol.setVolume(33);
      expect(settings.get().audio.masterVolume).toBe(33);
      // And a fresh store instance reads it back.
      const fresh = new SettingsStore();
      expect(fresh.get().audio.masterVolume).toBe(33);
    });
  });

  describe("mute / unmute", () => {
    it("mute() zeroes the volume and remembers the previous level", () => {
      vol.setVolume(60);
      vol.mute();
      expect(vol.getVolume()).toBe(0);
      expect(vol.isMuted()).toBe(true);
    });

    it("unmute() restores the pre-mute level", () => {
      vol.setVolume(45);
      vol.mute();
      vol.unmute();
      expect(vol.getVolume()).toBe(45);
      expect(vol.isMuted()).toBe(false);
    });

    it("toggleMute() cycles between the two states", () => {
      vol.setVolume(60);
      vol.toggleMute();
      expect(vol.getVolume()).toBe(0);
      vol.toggleMute();
      expect(vol.getVolume()).toBe(60);
    });

    it("mute() is a no-op when volume is already 0", () => {
      vol.setVolume(0);
      vol.mute();
      expect(vol.isMuted()).toBe(false);
      vol.unmute();
      // unmute on a non-muted state → no-op
      expect(vol.getVolume()).toBe(0);
    });

    it("manually sliding to 0 then back does NOT count as mute/unmute", () => {
      vol.setVolume(60);
      vol.setVolume(0);
      // We didn't call mute() — this is a manual slide, beforeMute is null.
      expect(vol.isMuted()).toBe(false);
      // Manual bump back up — no automatic restore to any previous value.
      vol.setVolume(20);
      expect(vol.getVolume()).toBe(20);
    });

    it("manual slide to non-zero while muted clears the mute memory", () => {
      vol.setVolume(60);
      vol.mute();
      expect(vol.isMuted()).toBe(true);

      vol.setVolume(30); // user dragged the slider while muted
      expect(vol.isMuted()).toBe(false);
      expect(vol.getVolume()).toBe(30);

      // unmute() now has no memory to restore from — no-op.
      vol.unmute();
      expect(vol.getVolume()).toBe(30);
    });
  });

  describe("onChange subscription", () => {
    it("fires on setVolume / mute / unmute / toggle", () => {
      const cb = vi.fn();
      vol.onChange(cb);
      vol.setVolume(50);
      vol.mute();
      vol.unmute();
      vol.toggleMute();
      vol.toggleMute();
      expect(cb).toHaveBeenCalledTimes(5);
    });

    it("setVolume with the same value does NOT re-emit", () => {
      vol.setVolume(30);
      const cb = vi.fn();
      vol.onChange(cb);
      vol.setVolume(30);
      expect(cb).not.toHaveBeenCalled();
    });

    it("unsubscribe stops further notifications", () => {
      const cb = vi.fn();
      const off = vol.onChange(cb);
      vol.setVolume(50);
      off();
      vol.setVolume(10);
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe("state reflects settings store across instances", () => {
    it("a fresh VolumeControl on the same SettingsStore sees the current value", () => {
      vol.setVolume(77);
      const other = new VolumeControl({ settings });
      expect(other.getVolume()).toBe(77);
      expect(other.getGainValue()).toBe(0.77);
    });
  });
});
