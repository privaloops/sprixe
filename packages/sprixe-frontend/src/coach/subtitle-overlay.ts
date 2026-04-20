/**
 * DOM overlay that displays streamed coach commentary at the bottom of
 * the playing canvas. Tokens are appended live; the line fades out a
 * short moment after the stream completes.
 */

const FADE_DELAY_MS = 6000;
const FADE_DURATION_MS = 700;

export class SubtitleOverlay {
  private readonly root: HTMLDivElement;
  private readonly line: HTMLDivElement;
  private currentBuffer = '';
  private fadeTimer: number | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'af-coach-overlay';
    this.line = document.createElement('div');
    this.line.className = 'af-coach-line';
    this.root.appendChild(this.line);
    parent.appendChild(this.root);
  }

  /** Call at the start of a new coach comment — clears the old line. */
  beginStream(): void {
    this.cancelFade();
    this.currentBuffer = '';
    this.line.textContent = '';
    this.root.classList.add('af-coach-visible');
  }

  appendToken(token: string): void {
    if (!this.root.classList.contains('af-coach-visible')) this.beginStream();
    this.cancelFade();
    this.currentBuffer += token;
    this.line.textContent = this.currentBuffer;
  }

  /** Called when the stream is done — schedules the fade-out. */
  endStream(): void {
    this.scheduleFade();
  }

  showError(message: string): void {
    this.cancelFade();
    this.line.textContent = `[coach offline: ${message}]`;
    this.root.classList.add('af-coach-visible', 'af-coach-error');
    this.scheduleFade(3000);
  }

  destroy(): void {
    this.cancelFade();
    this.root.remove();
  }

  private cancelFade(): void {
    if (this.fadeTimer !== null) {
      window.clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    this.root.classList.remove('af-coach-fading', 'af-coach-error');
  }

  private scheduleFade(delayMs: number = FADE_DELAY_MS): void {
    this.cancelFade();
    this.fadeTimer = window.setTimeout(() => {
      this.root.classList.add('af-coach-fading');
      this.fadeTimer = window.setTimeout(() => {
        this.root.classList.remove('af-coach-visible', 'af-coach-fading', 'af-coach-error');
        this.line.textContent = '';
        this.currentBuffer = '';
        this.fadeTimer = null;
      }, FADE_DURATION_MS);
    }, delayMs);
  }
}
