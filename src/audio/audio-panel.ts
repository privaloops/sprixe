/**
 * Audio DAW Panel — Cubase Key Editor style.
 *
 * FM section: 3-column grid
 *   Left:   channel strips (M/S, VU, name, note)
 *   Middle: shared vertical piano keyboard (80px, spans all 8 rows)
 *   Right:  per-channel piano roll timelines (note blocks by pitch)
 *
 * OKI section: channel strips + waveforms
 */

import { kcToNoteName, type VizReader } from "./audio-viz";
import type { Emulator } from "../emulator";

const FM_CHANNELS = 8;
const OKI_VOICES = 4;

// Piano: 3 octaves C2-B4
const PR_FIRST_OCTAVE = 2;
const PR_OCTAVES = 3;
const PR_KEYS = PR_OCTAVES * 12; // 36
const FM_ROW_H = 32; // px per FM channel strip
const FM_TOTAL_H = FM_CHANNELS * FM_ROW_H; // 256
const KB_WIDTH = 44;
const KEY_H = FM_TOTAL_H / PR_KEYS; // ~7px per key

const IS_BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const NOTE_LABELS = ["C", "", "D", "", "E", "F", "", "G", "", "A", "", "B"];

const KC_TO_SEMI = [1, 2, 3, -1, 4, 5, 6, -1, 7, 8, 9, -1, 10, 11, 0, -1];
function kcToAbsSemitone(kc: number): number {
  const octave = (kc >> 4) & 7;
  const noteIdx = kc & 0xF;
  const semi = KC_TO_SEMI[noteIdx];
  if (semi === undefined || semi < 0) return -1;
  return octave * 12 + semi;
}

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

  // Per-channel
  private readonly noteEls: HTMLSpanElement[] = [];
  private readonly vuCanvases: HTMLCanvasElement[] = [];
  private readonly vuCtxs: (CanvasRenderingContext2D | null)[] = [];
  private readonly muteButtons: HTMLButtonElement[] = [];
  private readonly soloButtons: HTMLButtonElement[] = [];

  // FM timelines (per-channel canvas, pitch on Y)
  private readonly fmTimeCanvases: HTMLCanvasElement[] = [];
  private readonly fmTimeCtxs: (CanvasRenderingContext2D | null)[] = [];

  // Shared keyboard canvas — shows notes of the selected FM channel
  private kbCanvas: HTMLCanvasElement | null = null;
  private kbCtx: CanvasRenderingContext2D | null = null;
  private selectedFmChannel = 0; // which FM channel the keyboard follows
  private readonly fmStripEls: HTMLElement[] = [];

  // OKI waveforms
  private readonly waveCanvases: HTMLCanvasElement[] = [];
  private readonly waveCtxs: (CanvasRenderingContext2D | null)[] = [];
  private readonly prevWaveY: number[] = [5, 5, 5, 5];

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

    // FM Section — 3-column grid: controls | keyboard | timelines
    const fmGrid = el("div", "aud-fm-grid") as HTMLDivElement;
    fmGrid.style.cssText = `display:grid; grid-template-columns: auto ${KB_WIDTH}px 1fr; grid-template-rows: repeat(${FM_CHANNELS}, ${FM_ROW_H}px); gap:0;`;

    // Column 1: channel strips
    for (let ch = 0; ch < FM_CHANNELS; ch++) {
      const strip = el("div", "aud-fm-strip");
      strip.append(
        this.createMuteBtn(ch),
        this.createSoloBtn(ch),
        this.createVu(ch),
      );
      const colorDot = el("span", "aud-ch-color");
      colorDot.style.background = CH_COLORS[ch]!;
      strip.appendChild(colorDot);
      const nameEl = el("span", "aud-ch-name");
      nameEl.textContent = `FM${ch + 1}`;
      strip.appendChild(nameEl);
      const noteEl = el("span", "aud-ch-note") as HTMLSpanElement;
      noteEl.textContent = "--";
      strip.appendChild(noteEl);
      this.noteEls[ch] = noteEl;

      // Click to select this channel for the keyboard
      strip.addEventListener("click", () => this.selectFmChannel(ch));
      if (ch === 0) strip.classList.add("selected");
      this.fmStripEls[ch] = strip;

      fmGrid.appendChild(strip);
    }

    // Column 2: shared keyboard (spans all 8 rows)
    this.kbCanvas = document.createElement("canvas");
    this.kbCanvas.width = KB_WIDTH;
    this.kbCanvas.height = FM_TOTAL_H;
    this.kbCanvas.className = "aud-kb-canvas";
    this.kbCanvas.style.cssText = `grid-column:2; grid-row:1/${FM_CHANNELS + 1};`;
    this.kbCtx = this.kbCanvas.getContext("2d")!;
    this.drawKeyboard();
    fmGrid.appendChild(this.kbCanvas);

    // Column 3: per-channel timelines (one canvas per row)
    for (let ch = 0; ch < FM_CHANNELS; ch++) {
      const cvs = document.createElement("canvas");
      cvs.width = 400;
      cvs.height = FM_ROW_H;
      cvs.className = "aud-fm-timeline";
      cvs.style.cssText = `grid-column:3; grid-row:${ch + 1};`;
      const ctx = cvs.getContext("2d")!;
      ctx.fillStyle = "#0d0d0d";
      ctx.fillRect(0, 0, 400, FM_ROW_H);
      fmGrid.appendChild(cvs);
      this.fmTimeCanvases[ch] = cvs;
      this.fmTimeCtxs[ch] = ctx;
    }

    c.appendChild(fmGrid);

    // Separator
    c.appendChild(el("div", "aud-separator"));

    // OKI Section
    const okiSection = el("div", "aud-channels");
    for (let v = 0; v < OKI_VOICES; v++) {
      okiSection.appendChild(this.createOkiRow(v));
    }
    c.appendChild(okiSection);
  }

  private createVu(idx: number): HTMLCanvasElement {
    const vu = document.createElement("canvas");
    vu.width = 4; vu.height = 16; vu.className = "aud-vu";
    this.vuCanvases[idx] = vu;
    this.vuCtxs[idx] = vu.getContext("2d");
    return vu;
  }

  private createOkiRow(voice: number): HTMLDivElement {
    const idx = FM_CHANNELS + voice;
    const color = CH_COLORS[idx]!;
    const row = el("div", "aud-ch-row") as HTMLDivElement;

    row.append(this.createMuteBtn(idx), this.createSoloBtn(idx), this.createVu(idx));

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

    const wave = document.createElement("canvas");
    wave.width = 300; wave.height = 10;
    wave.className = "aud-hit-timeline";
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
    btn.addEventListener("click", () => {
      if (this.soloed.has(idx)) this.soloed.delete(idx); else this.soloed.add(idx);
      btn.classList.toggle("active", this.soloed.has(idx));
      this.updateChannelMask();
    });
    this.soloButtons[idx] = btn;
    return btn;
  }

  private selectFmChannel(ch: number): void {
    this.selectedFmChannel = ch;
    for (let i = 0; i < FM_CHANNELS; i++) {
      this.fmStripEls[i]?.classList.toggle("selected", i === ch);
    }
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
    console.log(`[audio] channelMask=0x${mask.toString(16)} soloed=${[...this.soloed]} muted=${[...this.muted]}`);
    viz.setChannelMask(mask);
  }

  // -- Keyboard Drawing --

  private drawKeyboard(activeNotes?: Map<number, string>): void {
    const ctx = this.kbCtx!;
    const w = KB_WIDTH;
    const h = FM_TOTAL_H;
    const blackW = Math.round(w * 0.55);

    // Fill entire keyboard white
    ctx.fillStyle = "#ccc";
    ctx.fillRect(0, 0, w, h);

    // Draw white key separators (between E/F and B/C — the naturals without sharps between)
    for (let i = 0; i < PR_KEYS; i++) {
      const semi = i % 12;
      if (IS_BLACK[semi]) continue;
      const y = (PR_KEYS - 1 - i) * KEY_H;
      // Bottom border of each white key
      ctx.fillStyle = "#999";
      ctx.fillRect(0, y + KEY_H - 1, w, 1);
    }

    // Draw black keys on top (shorter, only covers left portion)
    for (let i = 0; i < PR_KEYS; i++) {
      const semi = i % 12;
      if (!IS_BLACK[semi]) continue;
      const y = (PR_KEYS - 1 - i) * KEY_H;
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(0, y, blackW, KEY_H);
      // Highlight edge
      ctx.fillStyle = "#333";
      ctx.fillRect(blackW - 1, y, 1, KEY_H);
    }

    // C labels
    for (let i = 0; i < PR_KEYS; i += 12) {
      const y = (PR_KEYS - 1 - i) * KEY_H;
      const octave = PR_FIRST_OCTAVE + Math.floor(i / 12);
      ctx.fillStyle = "#666";
      ctx.font = `${Math.min(KEY_H - 1, 9)}px Courier New`;
      ctx.fillText(`C${octave}`, blackW + 2, y + KEY_H - 1);
    }

    // Highlight active notes (pressed keys)
    if (activeNotes) {
      for (const [absSemi, color] of activeNotes) {
        const offset = absSemi - PR_FIRST_OCTAVE * 12;
        if (offset < 0 || offset >= PR_KEYS) continue;
        const y = (PR_KEYS - 1 - offset) * KEY_H;
        const semi = offset % 12;
        const isBlack = IS_BLACK[semi];

        // Colored pressed key
        ctx.fillStyle = color;
        if (isBlack) {
          ctx.fillRect(0, y, blackW, KEY_H);
        } else {
          ctx.fillRect(0, y, w, KEY_H - 1);
        }
        // Glow
        ctx.fillStyle = color + "33";
        ctx.fillRect(0, Math.max(0, y - 1), w, KEY_H + 2);
      }
    }
  }

  // -- Update --

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

    // FM channels — update strips (VU, note name)
    for (let ch = 0; ch < FM_CHANNELS; ch++) {
      const fm = viz.getFm(ch);
      const color = CH_COLORS[ch]!;

      this.noteEls[ch]!.textContent = fm.kon ? kcToNoteName(fm.kc) : "--";

      const vol = fm.kon ? Math.max(0, (127 - fm.tl) / 127 * 100) : 0;
      const vuCtx = this.vuCtxs[ch];
      if (vuCtx) this.drawVuMeter(vuCtx, vol, color);

      // Per-channel hit timeline (simple on/off block)
      const tCtx = this.fmTimeCtxs[ch];
      const tCvs = this.fmTimeCanvases[ch];
      if (tCtx && tCvs) {
        tCtx.drawImage(tCvs, -1, 0);
        tCtx.fillStyle = "#0d0d0d";
        tCtx.fillRect(tCvs.width - 1, 0, 1, FM_ROW_H);
        if (fm.kon) {
          tCtx.fillStyle = color;
          tCtx.fillRect(tCvs.width - 1, 2, 1, FM_ROW_H - 4);
        }
      }
    }

    // Keyboard + piano roll: show only the selected FM channel
    const selCh = this.selectedFmChannel;
    const selFm = viz.getFm(selCh);
    const selColor = CH_COLORS[selCh]!;
    const activeNotes = new Map<number, string>();
    if (selFm.kon) {
      activeNotes.set(kcToAbsSemitone(selFm.kc), selColor);
    }
    this.drawKeyboard(activeNotes);

    // OKI voices
    for (let v = 0; v < OKI_VOICES; v++) {
      const oki = viz.getOki(v);
      const idx = FM_CHANNELS + v;
      const color = CH_COLORS[idx]!;

      this.noteEls[idx]!.textContent = oki.playing ? `#${oki.phraseId}` : "--";

      const vol = oki.playing ? (oki.volume / 255 * 100) : 0;
      const vuCtx = this.vuCtxs[idx];
      if (vuCtx) this.drawVuMeter(vuCtx, vol, color);

      const wCtx = this.waveCtxs[v];
      if (wCtx) this.drawWaveform(wCtx, v, oki.playing ? oki.signal : 128, color);
    }
  }

  private drawVuMeter(ctx: CanvasRenderingContext2D, level: number, color: string): void {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, 4, 16);
    if (level > 0) {
      const barH = (level / 100) * 16;
      ctx.fillStyle = color;
      ctx.fillRect(0, 16 - barH, 4, barH);
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
}

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}
