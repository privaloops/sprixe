/**
 * Audio DAW Panel — Cubase-style Key Editor for CPS1 audio.
 *
 * Top: per-channel strips with M/S, VU, name, hit timeline
 * Bottom: shared piano roll (vertical keyboard left, note blocks scrolling right)
 */

import { kcToNoteName, type VizReader } from "./audio-viz";
import type { Emulator } from "../emulator";

const FM_CHANNELS = 8;
const OKI_VOICES = 4;
const TOTAL_CHANNELS = FM_CHANNELS + OKI_VOICES;

// Piano roll: 3 octaves (C2-B4 = 36 semitones)
const PR_FIRST_OCTAVE = 2;
const PR_OCTAVES = 3;
const PR_KEYS = PR_OCTAVES * 12; // 36
const PR_KEY_H = 6; // pixels per semitone row
const PR_KB_W = 28; // keyboard width on left
const PR_HEIGHT = PR_KEYS * PR_KEY_H; // 216

const IS_BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const NOTE_LABELS = ["C", "", "D", "", "E", "F", "", "G", "", "A", "", "B"];

// KC → absolute semitone
const KC_TO_SEMI = [1, 2, 3, -1, 4, 5, 6, -1, 7, 8, 9, -1, 10, 11, 0, -1];
function kcToAbsSemitone(kc: number): number {
  const octave = (kc >> 4) & 7;
  const noteIdx = kc & 0xF;
  const semi = KC_TO_SEMI[noteIdx];
  if (semi === undefined || semi < 0) return -1;
  return octave * 12 + semi;
}

// Per-channel colors
const CH_COLORS = [
  "#ff1a50", "#ff6b35", "#ffc234", "#4ecb71",
  "#36b5ff", "#8b5cf6", "#d946ef", "#f97316",
  "#06b6d4", "#84cc16", "#f43f5e", "#a78bfa",
];

export class AudioPanel {
  private active = false;
  private readonly emulator: Emulator;

  private readonly container: HTMLDivElement;
  private readonly audBtn: HTMLElement;

  // Per-channel elements
  private readonly noteEls: HTMLSpanElement[] = [];
  private readonly vuCanvases: HTMLCanvasElement[] = [];
  private readonly vuCtxs: (CanvasRenderingContext2D | null)[] = [];
  private readonly hitCanvases: HTMLCanvasElement[] = []; // FM: hit timeline
  private readonly hitCtxs: (CanvasRenderingContext2D | null)[] = [];
  private readonly waveCanvases: HTMLCanvasElement[] = []; // OKI: waveform
  private readonly waveCtxs: (CanvasRenderingContext2D | null)[] = [];
  private readonly muteButtons: HTMLButtonElement[] = [];
  private readonly soloButtons: HTMLButtonElement[] = [];

  // Waveform state
  private readonly prevWaveY: number[] = [7, 7, 7, 7];

  // Shared piano roll canvas
  private prCanvas: HTMLCanvasElement | null = null;
  private prCtx: CanvasRenderingContext2D | null = null;

  // Mute/Solo
  private readonly muted = new Set<number>();
  private readonly soloed = new Set<number>();

  private updateRafId = 0;

  constructor(emulator: Emulator) {
    this.emulator = emulator;
    this.container = document.getElementById("aud-panel") as HTMLDivElement;
    this.audBtn = document.getElementById("aud-btn")!;
    this.buildDOM();
    if (this.container.classList.contains("open")) {
      this.active = true;
      this.audBtn.classList.add("active");
    }
  }

  toggle(): void { if (this.active) this.close(); else this.open(); }
  isOpen(): boolean { return this.active; }

  onGameChange(): void {
    this.muted.clear();
    this.soloed.clear();
    for (const btn of this.muteButtons) btn?.classList.remove("active");
    for (const btn of this.soloButtons) btn?.classList.remove("active");
    const viz = this.emulator.getVizReader();
    if (viz) viz.setChannelMask(0xFFF);
    if (this.active) this.startUpdateLoop();
  }

  destroy(): void { this.close(); this.container.innerHTML = ""; }

  private open(): void {
    this.active = true;
    this.container.classList.add("open");
    document.body.classList.add("aud-active");
    this.audBtn.classList.add("active");
    this.startUpdateLoop();
  }

  private close(): void {
    this.active = false;
    this.container.classList.remove("open");
    document.body.classList.remove("aud-active");
    this.audBtn.classList.remove("active");
    cancelAnimationFrame(this.updateRafId);
  }

  // -- DOM --

  private buildDOM(): void {
    const c = this.container;
    c.innerHTML = "";

    // Header
    const header = el("div", "aud-header");
    const title = el("h2");
    title.textContent = "Audio";
    const closeBtn = el("button", "aud-close");
    closeBtn.textContent = "\u00D7";
    closeBtn.addEventListener("click", () => this.toggle());
    header.append(title, closeBtn);
    c.appendChild(header);

    // Channel strips
    const channels = el("div", "aud-channels");
    for (let i = 0; i < FM_CHANNELS; i++) {
      channels.appendChild(this.createFmStrip(i));
    }
    channels.appendChild(el("div", "aud-separator"));
    for (let i = 0; i < OKI_VOICES; i++) {
      channels.appendChild(this.createOkiStrip(i));
    }
    c.appendChild(channels);

    // Shared Piano Roll (Cubase Key Editor style)
    const prWrapper = el("div", "aud-pr-wrapper");
    this.prCanvas = document.createElement("canvas");
    this.prCanvas.className = "aud-pr-canvas";
    this.prCanvas.height = PR_HEIGHT;
    this.prCanvas.width = 600; // will be stretched via CSS
    this.prCtx = this.prCanvas.getContext("2d")!;
    this.initPianoRoll();
    prWrapper.appendChild(this.prCanvas);
    c.appendChild(prWrapper);
  }

  private createFmStrip(ch: number): HTMLDivElement {
    const color = CH_COLORS[ch]!;
    const row = el("div", "aud-ch-row") as HTMLDivElement;

    row.append(this.createMuteBtn(ch), this.createSoloBtn(ch));

    // VU
    const vu = document.createElement("canvas");
    vu.width = 4; vu.height = 14; vu.className = "aud-vu";
    row.appendChild(vu);
    this.vuCanvases[ch] = vu;
    this.vuCtxs[ch] = vu.getContext("2d");

    // Color + Name + Note
    const colorDot = el("span", "aud-ch-color");
    colorDot.style.background = color;
    row.appendChild(colorDot);
    const nameEl = el("span", "aud-ch-name");
    nameEl.textContent = `FM${ch + 1}`;
    row.appendChild(nameEl);
    const noteEl = el("span", "aud-ch-note") as HTMLSpanElement;
    noteEl.textContent = "--";
    row.appendChild(noteEl);
    this.noteEls[ch] = noteEl;

    // Hit timeline canvas (scrolling colored blocks when note is on)
    const hit = document.createElement("canvas");
    hit.width = 300; hit.height = 10; hit.className = "aud-hit-timeline";
    const hctx = hit.getContext("2d")!;
    hctx.fillStyle = "#111";
    hctx.fillRect(0, 0, 300, 10);
    row.appendChild(hit);
    this.hitCanvases[ch] = hit;
    this.hitCtxs[ch] = hctx;

    return row;
  }

  private createOkiStrip(voice: number): HTMLDivElement {
    const idx = FM_CHANNELS + voice;
    const color = CH_COLORS[idx]!;
    const row = el("div", "aud-ch-row") as HTMLDivElement;

    row.append(this.createMuteBtn(idx), this.createSoloBtn(idx));

    const vu = document.createElement("canvas");
    vu.width = 4; vu.height = 14; vu.className = "aud-vu";
    row.appendChild(vu);
    this.vuCanvases[idx] = vu;
    this.vuCtxs[idx] = vu.getContext("2d");

    const colorDot = el("span", "aud-ch-color");
    colorDot.style.background = color;
    row.appendChild(colorDot);
    const nameEl = el("span", "aud-ch-name");
    nameEl.textContent = `PCM${voice + 1}`;
    row.appendChild(nameEl);
    const noteEl = el("span", "aud-ch-note") as HTMLSpanElement;
    noteEl.textContent = "--";
    row.appendChild(noteEl);
    this.noteEls[idx] = noteEl;

    // Waveform
    const wave = document.createElement("canvas");
    wave.width = 300; wave.height = 10; wave.className = "aud-hit-timeline";
    const wctx = wave.getContext("2d")!;
    wctx.fillStyle = "#111";
    wctx.fillRect(0, 0, 300, 10);
    row.appendChild(wave);
    this.waveCanvases[voice] = wave;
    this.waveCtxs[voice] = wctx;

    return row;
  }

  private createMuteBtn(idx: number): HTMLButtonElement {
    const btn = el("button", "aud-ms-btn") as HTMLButtonElement;
    btn.textContent = "M";
    btn.title = "Mute";
    btn.addEventListener("click", () => {
      if (this.muted.has(idx)) this.muted.delete(idx); else this.muted.add(idx);
      btn.classList.toggle("active", this.muted.has(idx));
      this.updateChannelMask();
    });
    this.muteButtons[idx] = btn;
    return btn;
  }

  private createSoloBtn(idx: number): HTMLButtonElement {
    const btn = el("button", "aud-ms-btn aud-solo-btn") as HTMLButtonElement;
    btn.textContent = "S";
    btn.title = "Solo";
    btn.addEventListener("click", () => {
      if (this.soloed.has(idx)) this.soloed.delete(idx); else this.soloed.add(idx);
      btn.classList.toggle("active", this.soloed.has(idx));
      this.updateChannelMask();
    });
    this.soloButtons[idx] = btn;
    return btn;
  }

  private updateChannelMask(): void {
    const viz = this.emulator.getVizReader();
    if (!viz) return;
    let mask = 0;
    if (this.soloed.size > 0) {
      for (const ch of this.soloed) mask |= (1 << ch);
    } else {
      mask = 0xFFF;
      for (const ch of this.muted) mask &= ~(1 << ch);
    }
    viz.setChannelMask(mask);
  }

  // -- Piano Roll Drawing --

  private initPianoRoll(): void {
    const ctx = this.prCtx!;
    const cvs = this.prCanvas!;
    ctx.fillStyle = "#0d0d0d";
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    this.drawKeyboardColumn(ctx);
  }

  /** Draw the vertical piano keyboard on the left side. */
  private drawKeyboardColumn(ctx: CanvasRenderingContext2D): void {
    for (let i = 0; i < PR_KEYS; i++) {
      const semi = i % 12;
      // Piano roll: bottom = low notes, top = high notes
      const y = (PR_KEYS - 1 - i) * PR_KEY_H;

      if (IS_BLACK[semi]) {
        ctx.fillStyle = "#181818";
        ctx.fillRect(0, y, PR_KB_W, PR_KEY_H);
      } else {
        ctx.fillStyle = "#252525";
        ctx.fillRect(0, y, PR_KB_W, PR_KEY_H);
        // Border between white keys
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, y + PR_KEY_H - 1, PR_KB_W, 1);
      }

      // Label on C notes
      const label = NOTE_LABELS[semi];
      if (label) {
        const octave = PR_FIRST_OCTAVE + Math.floor(i / 12);
        ctx.fillStyle = "#555";
        ctx.font = "8px Courier New";
        ctx.fillText(`${label}${octave}`, 2, y + PR_KEY_H - 1);
      }
    }
  }

  // -- VU / Hit / Waveform drawing --

  private drawVuMeter(ctx: CanvasRenderingContext2D, level: number, color: string): void {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, 4, 14);
    if (level > 0) {
      const barH = (level / 100) * 14;
      ctx.fillStyle = color;
      ctx.fillRect(0, 14 - barH, 4, barH);
    }
  }

  private drawHitTimeline(ctx: CanvasRenderingContext2D, active: boolean, color: string): void {
    const w = 300;
    const h = 10;
    ctx.drawImage(ctx.canvas, -1, 0);
    ctx.fillStyle = "#111";
    ctx.fillRect(w - 1, 0, 1, h);
    if (active) {
      ctx.fillStyle = color;
      ctx.fillRect(w - 1, 1, 1, h - 2);
    }
  }

  private drawWaveform(ctx: CanvasRenderingContext2D, voice: number, signal: number, color: string): void {
    const w = 300;
    const h = 10;
    ctx.drawImage(ctx.canvas, -1, 0);
    ctx.fillStyle = "#111";
    ctx.fillRect(w - 1, 0, 1, h);
    const y = h - (signal / 255) * h;
    const prevY = this.prevWaveY[voice]!;
    const minY = Math.min(y, prevY);
    const maxY = Math.max(y, prevY);
    ctx.fillStyle = color;
    ctx.fillRect(w - 1, minY, 1, Math.max(1, maxY - minY + 1));
    this.prevWaveY[voice] = y;
  }

  // -- Update loop --

  private startUpdateLoop(): void {
    cancelAnimationFrame(this.updateRafId);
    let tick = 0;
    const update = (): void => {
      if (!this.active) return;
      tick++;
      if (tick % 3 === 0) this.updateAll();
      this.updateRafId = requestAnimationFrame(update);
    };
    this.updateRafId = requestAnimationFrame(update);
  }

  private updateAll(): void {
    const viz = this.emulator.getVizReader();
    if (!viz) return;

    const prCtx = this.prCtx;
    const prCvs = this.prCanvas;

    // Scroll piano roll left (only the timeline area, not the keyboard)
    if (prCtx && prCvs) {
      // Copy timeline area shifted left
      prCtx.drawImage(
        prCvs,
        PR_KB_W + 1, 0, prCvs.width - PR_KB_W - 1, PR_HEIGHT,
        PR_KB_W, 0, prCvs.width - PR_KB_W - 1, PR_HEIGHT
      );
      // Clear rightmost column
      prCtx.fillStyle = "#0d0d0d";
      prCtx.fillRect(prCvs.width - 1, 0, 1, PR_HEIGHT);
      // Draw subtle grid lines on C notes
      for (let i = 0; i < PR_KEYS; i += 12) {
        const y = (PR_KEYS - 1 - i) * PR_KEY_H;
        prCtx.fillStyle = "#1a1a1a";
        prCtx.fillRect(prCvs.width - 1, y, 1, 1);
      }
    }

    // FM channels
    for (let ch = 0; ch < FM_CHANNELS; ch++) {
      const fm = viz.getFm(ch);
      const color = CH_COLORS[ch]!;

      this.noteEls[ch]!.textContent = fm.kon ? kcToNoteName(fm.kc) : "--";

      const vol = fm.kon ? Math.max(0, (127 - fm.tl) / 127 * 100) : 0;
      const vuCtx = this.vuCtxs[ch];
      if (vuCtx) this.drawVuMeter(vuCtx, vol, color);

      // Hit timeline
      const hitCtx = this.hitCtxs[ch];
      if (hitCtx) this.drawHitTimeline(hitCtx, fm.kon, color);

      // Piano roll: draw note block on the shared canvas
      if (prCtx && prCvs && fm.kon) {
        const semi = kcToAbsSemitone(fm.kc);
        const offset = semi - PR_FIRST_OCTAVE * 12;
        if (offset >= 0 && offset < PR_KEYS) {
          const y = (PR_KEYS - 1 - offset) * PR_KEY_H;
          prCtx.fillStyle = color;
          prCtx.fillRect(prCvs.width - 1, y, 1, PR_KEY_H - 1);
        }

        // Highlight on keyboard
        this.highlightKey(prCtx, semi, color);
      }
    }

    // Reset keyboard highlights (redraw base keyboard, then active notes)
    if (prCtx) {
      this.drawKeyboardColumn(prCtx);
      for (let ch = 0; ch < FM_CHANNELS; ch++) {
        const fm = viz.getFm(ch);
        if (fm.kon) {
          const semi = kcToAbsSemitone(fm.kc);
          this.highlightKey(prCtx, semi, CH_COLORS[ch]!);
        }
      }
    }

    // OKI voices
    for (let v = 0; v < OKI_VOICES; v++) {
      const oki = viz.getOki(v);
      const idx = FM_CHANNELS + v;
      const color = CH_COLORS[idx]!;

      this.noteEls[idx]!.textContent = oki.playing ? `#${oki.phraseId}` : "--";

      const vol = oki.playing ? (oki.volume / 255 * 100) : 0;
      const vuCtx = this.vuCtxs[idx];
      if (vuCtx) this.drawVuMeter(vuCtx, vol, color);

      const waveCtx = this.waveCtxs[v];
      if (waveCtx) this.drawWaveform(waveCtx, v, oki.playing ? oki.signal : 128, color);
    }
  }

  private highlightKey(ctx: CanvasRenderingContext2D, absSemi: number, color: string): void {
    const offset = absSemi - PR_FIRST_OCTAVE * 12;
    if (offset < 0 || offset >= PR_KEYS) return;
    const y = (PR_KEYS - 1 - offset) * PR_KEY_H;
    ctx.fillStyle = color;
    ctx.fillRect(0, y, PR_KB_W, PR_KEY_H - 1);
  }
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
