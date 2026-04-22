import type { CoachController } from "@sprixe/coach/coach-controller";
import type { HitboxRect } from "@sprixe/coach/types";

const CPS1_SCREEN_WIDTH = 384;
const CPS1_SCREEN_HEIGHT = 224;
// Empirically calibrated from a ground-standing P1 (posY=40 in RAM).
// 240 matches the CPS1 playfield ground line (≈ screen y=200 for feet).
// Formula: screen_y = OFFSET - posY. Tune here if characters look shifted.
const WORLD_TO_SCREEN_Y_OFFSET = 240;

const COLORS: Record<HitboxRect["kind"], string> = {
  attack: "rgba(255, 40, 40, 0.55)",
  hurt_head: "rgba(40, 220, 80, 0.40)",
  hurt_body: "rgba(40, 220, 80, 0.40)",
  hurt_legs: "rgba(40, 220, 80, 0.40)",
  push: "rgba(80, 140, 255, 0.30)",
};

/**
 * Debug overlay that draws the live hitboxes read from SF2HF RAM on top
 * of the game canvas. Toggled via a keyboard shortcut so it can be
 * flipped on/off without recompiling.
 *
 * World → screen conversion: screen_x = world_x - cameraX. Y is already
 * in screen-local space (pos_y counts from the top of the playfield).
 */
export class HitboxOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly gameCanvas: HTMLCanvasElement;
  private readonly coach: CoachController;
  private rafId: number | null = null;
  private enabled = false;
  private resizeObserver: ResizeObserver | null = null;
  private keyListener: ((e: KeyboardEvent) => void) | null = null;

  constructor(gameCanvas: HTMLCanvasElement, coach: CoachController) {
    this.gameCanvas = gameCanvas;
    this.coach = coach;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "sprixe-hitbox-overlay";
    this.canvas.style.position = "absolute";
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.zIndex = "999";
    this.canvas.style.display = "none";
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("overlay: 2d context unavailable");
    this.ctx = ctx;
    this.positionOverCanvas();
    gameCanvas.parentElement?.appendChild(this.canvas);

    // Keep the overlay glued to the game canvas as it resizes.
    this.resizeObserver = new ResizeObserver(() => this.positionOverCanvas());
    this.resizeObserver.observe(gameCanvas);

    // F7 toggles the overlay. Kept simple — no UI for now.
    this.keyListener = (e) => {
      if (e.key === "F7") {
        e.preventDefault();
        this.toggle();
      }
    };
    window.addEventListener("keydown", this.keyListener);
  }

  private positionOverCanvas(): void {
    const rect = this.gameCanvas.getBoundingClientRect();
    const parentRect = this.gameCanvas.parentElement?.getBoundingClientRect();
    const offsetX = parentRect ? rect.left - parentRect.left : 0;
    const offsetY = parentRect ? rect.top - parentRect.top : 0;
    this.canvas.style.left = `${offsetX}px`;
    this.canvas.style.top = `${offsetY}px`;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.canvas.width = CPS1_SCREEN_WIDTH;
    this.canvas.height = CPS1_SCREEN_HEIGHT;
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.canvas.style.display = this.enabled ? "block" : "none";
    console.log(`[hitbox-overlay] ${this.enabled ? "ON" : "OFF"} — press F7 to toggle`);
    if (this.enabled) this.startLoop();
    else this.stopLoop();
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    const tick = () => {
      this.draw();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private draw(): void {
    const state = this.coach.getLatestState();
    if (!state) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CPS1_SCREEN_WIDTH, CPS1_SCREEN_HEIGHT);
    const cameraX = state.cameraX ?? 0;
    this.drawChar(ctx, state.p1, cameraX);
    this.drawChar(ctx, state.p2, cameraX);
    this.drawDebugText(ctx, state, cameraX);
  }

  private drawDebugText(
    ctx: CanvasRenderingContext2D,
    state: { p1: { x: number; posY?: number }; p2: { x: number; posY?: number }; cameraX?: number },
    cameraX: number,
  ): void {
    ctx.fillStyle = "rgba(255, 255, 0, 0.95)";
    ctx.font = "8px monospace";
    ctx.fillText(`cam=${cameraX}`, 4, 10);
    ctx.fillText(`P1 x=${state.p1.x} y=${state.p1.posY ?? "?"}`, 4, 20);
    ctx.fillText(`P2 x=${state.p2.x} y=${state.p2.posY ?? "?"}`, 4, 30);
    // Reference ground line: expected floor screen Y = 230 - 40 = 190.
    const groundY = WORLD_TO_SCREEN_Y_OFFSET - 40;
    ctx.strokeStyle = "rgba(255, 255, 0, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(CPS1_SCREEN_WIDTH, groundY);
    ctx.stroke();
  }

  private drawChar(
    ctx: CanvasRenderingContext2D,
    char: { hurtboxes?: HitboxRect[]; attackbox?: HitboxRect | null; pushbox?: HitboxRect | null },
    cameraX: number,
  ): void {
    const boxes: HitboxRect[] = [];
    if (char.pushbox) boxes.push(char.pushbox);
    if (char.hurtboxes) boxes.push(...char.hurtboxes);
    if (char.attackbox) boxes.push(char.attackbox);
    for (const b of boxes) this.drawRect(ctx, b, cameraX);
  }

  private drawRect(ctx: CanvasRenderingContext2D, box: HitboxRect, cameraX: number): void {
    // World X → screen X: subtract camera. World Y (grows up) → screen Y
    // (grows down): invert around the tuned baseline.
    const screenCx = box.cx - cameraX;
    const screenCy = WORLD_TO_SCREEN_Y_OFFSET - box.cy;
    const x = screenCx - box.halfW;
    const y = screenCy - box.halfH;
    const w = box.halfW * 2;
    const h = box.halfH * 2;
    ctx.fillStyle = COLORS[box.kind];
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = COLORS[box.kind].replace(/[\d.]+\)$/, "1.0)");
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  destroy(): void {
    this.stopLoop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.keyListener) {
      window.removeEventListener("keydown", this.keyListener);
      this.keyListener = null;
    }
    this.canvas.remove();
  }
}
