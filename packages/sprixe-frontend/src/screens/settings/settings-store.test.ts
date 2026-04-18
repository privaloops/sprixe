import { describe, it, expect, beforeEach, vi } from "vitest";
import { SettingsStore, DEFAULT_SETTINGS, STORAGE_KEY, type SettingsV1 } from "./settings-store";

describe("SettingsStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("defaults + load", () => {
    it("returns DEFAULT_SETTINGS when storage is empty", () => {
      const store = new SettingsStore();
      expect(store.get()).toEqual(DEFAULT_SETTINGS);
    });

    it("loads a previously-persisted payload verbatim", () => {
      const payload: SettingsV1 = {
        version: 1,
        display: { crtFilter: true, aspectRatio: "16:9", integerScaling: false, scanlineOpacity: 0.7, tate: true },
        audio: { masterVolume: 40, latency: "low" },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      const store = new SettingsStore();
      expect(store.get()).toEqual(payload);
    });

    it("malformed JSON falls back to defaults without throwing", () => {
      localStorage.setItem(STORAGE_KEY, "not json at all");
      const store = new SettingsStore();
      expect(store.get()).toEqual(DEFAULT_SETTINGS);
    });

    it("foreign version field → defaults", () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, display: {}, audio: {} }));
      const store = new SettingsStore();
      expect(store.get()).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe("update + patch semantics", () => {
    it("deep-merges a display patch without touching audio", () => {
      const store = new SettingsStore();
      store.update({ display: { crtFilter: true, integerScaling: false } });
      expect(store.get().display.crtFilter).toBe(true);
      expect(store.get().display.integerScaling).toBe(false);
      expect(store.get().display.aspectRatio).toBe(DEFAULT_SETTINGS.display.aspectRatio);
      expect(store.get().audio).toEqual(DEFAULT_SETTINGS.audio);
    });

    it("update persists immediately", () => {
      const store = new SettingsStore();
      store.update({ audio: { masterVolume: 60 } });
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as SettingsV1;
      expect(raw.audio.masterVolume).toBe(60);
    });

    it("round-tripping across a new store instance preserves the patch", () => {
      const a = new SettingsStore();
      a.update({ display: { crtFilter: true }, audio: { masterVolume: 25 } });
      const b = new SettingsStore();
      expect(b.get().display.crtFilter).toBe(true);
      expect(b.get().audio.masterVolume).toBe(25);
    });

    it("clamps volume to [0, 100]", () => {
      const store = new SettingsStore();
      store.update({ audio: { masterVolume: 150 } });
      expect(store.get().audio.masterVolume).toBe(100);
      store.update({ audio: { masterVolume: -5 } });
      expect(store.get().audio.masterVolume).toBe(0);
    });

    it("clamps scanlineOpacity to [0, 1]", () => {
      const store = new SettingsStore();
      store.update({ display: { scanlineOpacity: 5 } });
      expect(store.get().display.scanlineOpacity).toBe(1);
      store.update({ display: { scanlineOpacity: -1 } });
      expect(store.get().display.scanlineOpacity).toBe(0);
    });

    it("rejects foreign aspectRatio values (keeps current)", () => {
      const store = new SettingsStore();
      store.update({ display: { aspectRatio: "fisheye" as unknown as "4:3" } });
      expect(store.get().display.aspectRatio).toBe(DEFAULT_SETTINGS.display.aspectRatio);
    });

    it("rejects foreign latency values", () => {
      const store = new SettingsStore();
      store.update({ audio: { latency: "ultra" as unknown as "low" } });
      expect(store.get().audio.latency).toBe(DEFAULT_SETTINGS.audio.latency);
    });
  });

  describe("reset", () => {
    it("wipes back to DEFAULT_SETTINGS and persists", () => {
      const store = new SettingsStore();
      store.update({ display: { crtFilter: true }, audio: { masterVolume: 20 } });
      store.reset();
      expect(store.get()).toEqual(DEFAULT_SETTINGS);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(DEFAULT_SETTINGS);
    });
  });

  describe("onChange", () => {
    it("fires for update, replace, and reset", () => {
      const store = new SettingsStore();
      const cb = vi.fn();
      store.onChange(cb);

      store.update({ display: { tate: true } });
      store.replace({ ...DEFAULT_SETTINGS, audio: { masterVolume: 10, latency: "low" } });
      store.reset();

      expect(cb).toHaveBeenCalledTimes(3);
    });

    it("unsubscribe stops further notifications", () => {
      const store = new SettingsStore();
      const cb = vi.fn();
      const off = store.onChange(cb);
      store.update({ display: { tate: true } });
      off();
      store.update({ display: { tate: false } });
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe("storage unavailability", () => {
    it("still returns defaults when setItem throws (quota exceeded)", () => {
      const throwingStorage: Storage = {
        length: 0,
        clear: () => {},
        getItem: () => null,
        key: () => null,
        removeItem: () => {},
        setItem: () => { throw new DOMException("quota", "QuotaExceededError"); },
      };
      const store = new SettingsStore(throwingStorage);
      expect(() => store.update({ audio: { masterVolume: 50 } })).not.toThrow();
      // In-memory snapshot is still updated.
      expect(store.get().audio.masterVolume).toBe(50);
    });
  });
});
