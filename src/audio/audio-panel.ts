/**
 * Audio DAW Panel — real-time visualization of CPS1 audio channels.
 *
 * Layout per FM row (Cubase-style):
 *   [M][S] [VU] NAME  NOTE  [===mini keyboard===]
 *
 * Layout per OKI row:
 *   [M][S] [VU] NAME  #ID   [~~~waveform~~~~~~~~]
 */

import { kcToNoteName, type VizReader } from "./audio-viz";
import type { Emulator } from "../emulator";

const FM_CHANNELS = 8;
const OKI_VOICES = 4;
const TOTAL_CHANNELS = FM_CHANNELS + OKI_VOICES;

// Mini keyboard: 4 octaves (octaves 2-5), 48 semitones
const KB_OCTAVES = 4;
const KB_FIRST_OCTAVE = 2;
const KB_KEYS = KB_OCTAVES * 12;
const KB_WIDTH = 192;
const KB_HEIGHT = 14;

// Per-channel colors
const CH_COLORS = [
  "#ff1a50", "#ff6b35", "#ffc234", "#4ecb71",
  "#36b5ff", "#8b5cf6", "#d946ef", "#f97316",
  "#06b6d4", "#84cc16", "#f43f5e", "#a78bfa",
];

// YM2151 KC → semitone (within octave). KC bits 3-0 map unevenly.
const KC_TO_SEMI = [1, 2, 3, -1, 4, 5, 6, -1, 7, 8, 9, -1, 10, 11, 0, -1];
// Black key pattern (0=white, 1=black) for C C# D D# E F F# G G# A A# B
const IS_BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

function kcToAbsSemitone(kc: number): number {
  const octave = (kc >> 4) & 7;
  const noteIdx = kc & 0xF;
  const semi = KC_TO_SEMI[noteIdx];
  if (semi === undefined || semi < 0) return -1;
  return octave * 12 + semi;
}

export class AudioPanel {
  private active = false;
  private readonly emulator: Emulator;

  // DOM
  private readonly container: HTMLDivElement;
  private readonly audBtn: HTMLElement;

  // Per-channel elements
  private readonly noteEls: HTMLSpanElement[] = [];
  private readonly vuCanvases: HTMLCanvasElement[] = [];
  private readonly vuCtxs: (CanvasRenderingContext2D | null)[] = [];
  private readonly kbCanvases: HTMLCanvasElement[] = []; // FM only
  private readonly kbCtxs: (CanvasRenderingContext2D | null)[] = [];
  private readonly waveCanvases: HTMLCanvasElement[] = []; // OKI only
  private readonly waveCtxs: (CanvasRenderingContext2D | null)[] = [];
  private readonly muteButtons: HTMLButtonElement[] = [];
  private readonly soloButtons: HTMLButtonElement[] = [];

  // Mute/Solo
  private readonly muted = new Set<number>();
  private readonly soloed = new Set<number>();

  // Waveform previous Y per OKI voice
  private readonly prevWaveY: number[] = [7, 7, 7, 7];

  // Piano roll
  private pianoCanvas: HTMLCanvasElement | null = null;
  private pianoCtx: CanvasRenderingContext2D | null = null;

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

    const channels = el("div", "aud-channels");

    // FM channels
    for (let i = 0; i < FM_CHANNELS; i++) {
      channels.appendChild(this.createFmRow(i));
    }

    // Separator
    channels.appendChild(el("div", "aud-separator"));

    // OKI voices
    for (let i = 0; i < OKI_VOICES; i++) {
      channels.appendChild(this.createOkiRow(i));
    }

    c.appendChild(channels);

    // Piano roll
    const pianoWrapper = el("div", "aud-piano-wrapper");
    this.pianoCanvas = document.createElement("canvas");
    this.pianoCanvas.className = "aud-piano-canvas";
    this.pianoCanvas.height = TOTAL_CHANNELS * 16;
    this.pianoCanvas.width = 400;
    this.pianoCtx = this.pianoCanvas.getContext("2d")!;
    this.pianoCtx.fillStyle = "#0a0a0a";
    this.pianoCtx.fillRect(0, 0, 400, this.pianoCanvas.height);
    pianoWrapper.appendChild(this.pianoCanvas);
    c.appendChild(pianoWrapper);
  }

  private createFmRow(ch: number): HTMLDivElement {
    const color = CH_COLORS[ch]!;
    const row = el("div", "aud-ch-row") as HTMLDivElement;

    // M / S buttons (left, Cubase-style)
    row.append(this.createMuteBtn(ch), this.createSoloBtn(ch));

    // VU meter (tiny vertical canvas)
    const vu = document.createElement("canvas");
    vu.width = 4; vu.height = 14;
    vu.className = "aud-vu";
    row.appendChild(vu);
    this.vuCanvases[ch] = vu;
    this.vuCtxs[ch] = vu.getContext("2d");

    // Color + Name
    const colorDot = el("span", "aud-ch-color");
    colorDot.style.background = color;
    row.appendChild(colorDot);
    const nameEl = el("span", "aud-ch-name");
    nameEl.textContent = `FM${ch + 1}`;
    row.appendChild(nameEl);

    // Note
    const noteEl = el("span", "aud-ch-note") as HTMLSpanElement;
    noteEl.textContent = "--";
    row.appendChild(noteEl);
    this.noteEls[ch] = noteEl;

    // Mini keyboard canvas
    const kb = document.createElement("canvas");
    kb.width = KB_WIDTH; kb.height = KB_HEIGHT;
    kb.className = "aud-keyboard";
    row.appendChild(kb);
    this.kbCanvases[ch] = kb;
    this.kbCtxs[ch] = kb.getContext("2d");
    this.drawKeyboard(this.kbCtxs[ch]!, -1, color);

    return row;
  }

  private createOkiRow(voice: number): HTMLDivElement {
    const idx = FM_CHANNELS + voice;
    const color = CH_COLORS[idx]!;
    const row = el("div", "aud-ch-row") as HTMLDivElement;

    // M / S buttons
    row.append(this.createMuteBtn(idx), this.createSoloBtn(idx));

    // VU meter
    const vu = document.createElement("canvas");
    vu.width = 4; vu.height = 14;
    vu.className = "aud-vu";
    row.appendChild(vu);
    this.vuCanvases[idx] = vu;
    this.vuCtxs[idx] = vu.getContext("2d");

    // Color + Name
    const colorDot = el("span", "aud-ch-color");
    colorDot.style.background = color;
    row.appendChild(colorDot);
    const nameEl = el("span", "aud-ch-name");
    nameEl.textContent = `PCM${voice + 1}`;
    row.appendChild(nameEl);

    // Phrase ID
    const noteEl = el("span", "aud-ch-note") as HTMLSpanElement;
    noteEl.textContent = "--";
    row.appendChild(noteEl);
    this.noteEls[idx] = noteEl;

    // Waveform canvas (scrolling oscilloscope)
    const wave = document.createElement("canvas");
    wave.width = 192; wave.height = KB_HEIGHT;
    wave.className = "aud-waveform";
    row.appendChild(wave);
    this.waveCanvases[voice] = wave;
    this.waveCtxs[voice] = wave.getContext("2d");
    // Init to black
    const wctx = this.waveCtxs[voice]!;
    wctx.fillStyle = "#111";
    wctx.fillRect(0, 0, 192, KB_HEIGHT);

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

  // -- Drawing --

  private drawKeyboard(ctx: CanvasRenderingContext2D, activeNote: number, color: string): void {
    const w = KB_WIDTH;
    const h = KB_HEIGHT;
    const keyW = w / KB_KEYS;

    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < KB_KEYS; i++) {
      const semi = i % 12;
      const x = i * keyW;

      if (IS_BLACK[semi]) {
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(x, 0, keyW, h * 0.65);
      } else {
        // White key border
        ctx.fillStyle = "#222";
        ctx.fillRect(x, 0, 0.5, h);
      }
    }

    // Highlight active note — white, full height, with glow
    if (activeNote >= 0) {
      const offset = activeNote - KB_FIRST_OCTAVE * 12;
      if (offset >= 0 && offset < KB_KEYS) {
        const x = offset * keyW;
        const kw = Math.max(keyW, 3);
        // Glow in channel color
        ctx.fillStyle = color + "55";
        ctx.fillRect(Math.max(0, x - 3), 0, kw + 6, h);
        // White key
        ctx.fillStyle = "#fff";
        ctx.fillRect(x, 0, kw, h);
      }
    }
  }

  private drawVuMeter(ctx: CanvasRenderingContext2D, level: number, color: string): void {
    const w = 4;
    const h = 14;
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);
    if (level > 0) {
      const barH = (level / 100) * h;
      ctx.fillStyle = color;
      ctx.fillRect(0, h - barH, w, barH);
    }
  }

  private drawWaveform(ctx: CanvasRenderingContext2D, voice: number, signal: number, color: string): void {
    const w = 192;
    const h = KB_HEIGHT;
    // Scroll left
    ctx.drawImage(ctx.canvas, -1, 0);
    // Clear rightmost column
    ctx.fillStyle = "#111";
    ctx.fillRect(w - 1, 0, 1, h);

    // Draw line from previous Y to current Y
    const y = h - (signal / 255) * h;
    const prevY = this.prevWaveY[voice]!;
    const minY = Math.min(y, prevY);
    const maxY = Math.max(y, prevY);
    const lineH = Math.max(1, maxY - minY + 1);
    ctx.fillStyle = color;
    ctx.fillRect(w - 1, minY, 1, lineH);
    this.prevWaveY[voice] = y;
  }

  // -- Update --

  private startUpdateLoop(): void {
    cancelAnimationFrame(this.updateRafId);
    let tick = 0;
    const update = (): void => {
      if (!this.active) return;
      tick++;
      if (tick % 3 === 0) {
        this.updateAll();
      }
      this.updateRafId = requestAnimationFrame(update);
    };
    this.updateRafId = requestAnimationFrame(update);
  }

  private updateAll(): void {
    const viz = this.emulator.getVizReader();
    if (!viz) return;

    // FM channels
    for (let ch = 0; ch < FM_CHANNELS; ch++) {
      const fm = viz.getFm(ch);
      const color = CH_COLORS[ch]!;

      // Note name
      this.noteEls[ch]!.textContent = fm.kon ? kcToNoteName(fm.kc) : "--";

      // VU meter
      const vol = fm.kon ? Math.max(0, (127 - fm.tl) / 127 * 100) : 0;
      const vuCtx = this.vuCtxs[ch];
      if (vuCtx) this.drawVuMeter(vuCtx, vol, color);

      // Mini keyboard
      const kbCtx = this.kbCtxs[ch];
      if (kbCtx) {
        const semi = fm.kon ? kcToAbsSemitone(fm.kc) : -1;
        this.drawKeyboard(kbCtx, semi, color);
      }
    }

    // OKI voices
    for (let v = 0; v < OKI_VOICES; v++) {
      const oki = viz.getOki(v);
      const idx = FM_CHANNELS + v;
      const color = CH_COLORS[idx]!;

      this.noteEls[idx]!.textContent = oki.playing ? `#${oki.phraseId}` : "--";

      // VU meter
      const vol = oki.playing ? (oki.volume / 255 * 100) : 0;
      const vuCtx = this.vuCtxs[idx];
      if (vuCtx) this.drawVuMeter(vuCtx, vol, color);

      // Waveform
      const waveCtx = this.waveCtxs[v];
      if (waveCtx) this.drawWaveform(waveCtx, v, oki.playing ? oki.signal : 128, color);
    }

    // Piano roll
    this.updatePianoRoll(viz);
  }

  private updatePianoRoll(viz: VizReader): void {
    const ctx = this.pianoCtx;
    const cvs = this.pianoCanvas;
    if (!ctx || !cvs) return;

    const w = cvs.width;
    const rowH = 16;

    ctx.drawImage(cvs, -1, 0);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(w - 1, 0, 1, cvs.height);

    for (let ch = 0; ch < FM_CHANNELS; ch++) {
      if (viz.getFm(ch).kon) {
        ctx.fillStyle = CH_COLORS[ch]!;
        ctx.fillRect(w - 1, ch * rowH + 2, 1, rowH - 4);
      }
    }
    for (let v = 0; v < OKI_VOICES; v++) {
      if (viz.getOki(v).playing) {
        ctx.fillStyle = CH_COLORS[FM_CHANNELS + v]!;
        ctx.fillRect(w - 1, (FM_CHANNELS + v) * rowH + 2, 1, rowH - 4);
      }
    }
  }
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
