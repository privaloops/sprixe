import { describe, it, expect, beforeEach, vi } from "vitest";
import { SettingsScreen } from "./settings-screen";
import { SettingsStore } from "./settings-store";

describe("SettingsScreen", () => {
  let container: HTMLDivElement;
  let settings: SettingsStore;
  let onClose: ReturnType<typeof vi.fn>;
  let screen: SettingsScreen;

  beforeEach(() => {
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    localStorage.clear();
    settings = new SettingsStore();
    onClose = vi.fn<() => void>();
    screen = new SettingsScreen(container, {
      settings,
      onClose: onClose as unknown as () => void,
      version: "test-1.0",
    });
  });

  describe("tabs", () => {
    it("mounts with 'display' tab active by default", () => {
      expect(screen.getActiveTab()).toBe("display");
      const active = container.querySelector<HTMLElement>(".af-settings-tab.active")!;
      expect(active.dataset.tabId).toBe("display");
    });

    it("setActiveTab updates DOM aria-selected", () => {
      screen.setActiveTab("audio");
      const audio = container.querySelector<HTMLElement>('[data-testid="settings-tab-audio"]')!;
      expect(audio.getAttribute("aria-selected")).toBe("true");
      const display = container.querySelector<HTMLElement>('[data-testid="settings-tab-display"]')!;
      expect(display.getAttribute("aria-selected")).toBe("false");
    });

    it("clicking a tab button switches context", () => {
      container.querySelector<HTMLButtonElement>('[data-testid="settings-tab-about"]')!.click();
      expect(screen.getActiveTab()).toBe("about");
    });

    it("bumper-right / bumper-left cycle through tabs", () => {
      screen.handleNavAction("bumper-right");
      expect(screen.getActiveTab()).toBe("audio");
      screen.handleNavAction("bumper-right");
      expect(screen.getActiveTab()).toBe("about");
      screen.handleNavAction("bumper-right"); // wraps
      expect(screen.getActiveTab()).toBe("display");
      screen.handleNavAction("bumper-left");  // wraps back
      expect(screen.getActiveTab()).toBe("about");
    });
  });

  describe("display tab form controls", () => {
    it("toggling CRT Filter persists through SettingsStore", () => {
      const toggle = container.querySelector<HTMLInputElement>(".af-settings-toggle")!;
      expect(toggle.checked).toBe(false);
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change"));
      expect(settings.get().display.crtFilter).toBe(true);
    });

    it("aspect-ratio select writes to settings", () => {
      const select = container.querySelector<HTMLSelectElement>('[data-testid="setting-aspect-ratio"] select')!;
      select.value = "16:9";
      select.dispatchEvent(new Event("change"));
      expect(settings.get().display.aspectRatio).toBe("16:9");
    });

    it("scanline opacity slider converts 0-100 → 0-1 float", () => {
      const slider = container.querySelectorAll<HTMLInputElement>(".af-settings-slider")[0]!;
      slider.value = "75";
      slider.dispatchEvent(new Event("change"));
      expect(settings.get().display.scanlineOpacity).toBe(0.75);
    });
  });

  describe("audio tab", () => {
    beforeEach(() => screen.setActiveTab("audio"));

    it("master volume slider writes to settings", () => {
      const slider = container.querySelector<HTMLInputElement>('[data-testid="setting-volume"] input[type="range"]')!;
      slider.value = "42";
      slider.dispatchEvent(new Event("change"));
      expect(settings.get().audio.masterVolume).toBe(42);
    });

    it("latency select writes to settings", () => {
      const select = container.querySelector<HTMLSelectElement>('[data-testid="setting-latency"] select')!;
      select.value = "low";
      select.dispatchEvent(new Event("change"));
      expect(settings.get().audio.latency).toBe("low");
    });
  });

  describe("about tab", () => {
    it("displays the injected version", () => {
      screen.setActiveTab("about");
      const about = container.querySelector<HTMLElement>('[data-testid="settings-about"]')!;
      expect(about.textContent).toContain("test-1.0");
    });
  });

  describe("close", () => {
    it("back button closes the screen and invokes onClose", () => {
      container.querySelector<HTMLButtonElement>('[data-testid="settings-back"]')!.click();
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[data-testid="settings-screen"]')).toBeNull();
    });

    it("handleNavAction('back') closes the screen", () => {
      screen.handleNavAction("back");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("handleNavAction('coin-hold') closes the screen", () => {
      screen.handleNavAction("coin-hold");
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("live re-render on external settings change", () => {
    it("a SettingsStore update while the screen is mounted refreshes the UI", () => {
      const toggle = () => container.querySelector<HTMLInputElement>(".af-settings-toggle")!;
      expect(toggle().checked).toBe(false);
      // External update (phone remote, CLI, whatever).
      settings.update({ display: { crtFilter: true } });
      expect(toggle().checked).toBe(true);
    });
  });
});
