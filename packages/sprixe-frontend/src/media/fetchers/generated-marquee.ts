/**
 * generated-marquee — last-resort fallback when neither the CDN nor
 * libretro-thumbnails yield a title screen. Paints the game title on
 * an arcade-themed gradient (deep bg + cyan/red accent glow) and
 * returns a PNG Blob that slots into MediaCache like a real asset.
 *
 * Output stays in step with the site's accent palette so the
 * generated marquee blends into the browser panel instead of looking
 * like a placeholder.
 */

const WIDTH = 1024;
const HEIGHT = 160;

export function generateMarquee(title: string): Promise<Blob | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);

  // Dark arcade background — matches --af-bg-card / --af-bg-deep.
  const bg = ctx.createLinearGradient(0, 0, WIDTH, 0);
  bg.addColorStop(0, "#0a0a10");
  bg.addColorStop(0.5, "#12121a");
  bg.addColorStop(1, "#0a0a10");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Subtle scanline texture so even the fallback feels CRT-adjacent.
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = "#000";
  for (let y = 0; y < HEIGHT; y += 3) {
    ctx.fillRect(0, y, WIDTH, 1);
  }
  ctx.globalAlpha = 1;

  // Accent stripe top + bottom — mimics the neon edge of a cabinet
  // marquee light bar.
  const stripe = ctx.createLinearGradient(0, 0, WIDTH, 0);
  stripe.addColorStop(0, "rgba(0, 212, 255, 0)");
  stripe.addColorStop(0.5, "rgba(0, 212, 255, 0.9)");
  stripe.addColorStop(1, "rgba(0, 212, 255, 0)");
  ctx.fillStyle = stripe;
  ctx.fillRect(0, 0, WIDTH, 2);
  ctx.fillRect(0, HEIGHT - 2, WIDTH, 2);

  // Title — uppercase, tracked, glowing cyan like the accent rail.
  const text = title.trim().toUpperCase();
  ctx.shadowColor = "rgba(0, 212, 255, 0.55)";
  ctx.shadowBlur = 24;
  ctx.fillStyle = "#f0f0f5";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const size = fitFontSize(ctx, text, WIDTH - 80);
  ctx.font = `700 ${size}px "Rajdhani", "Inter", sans-serif`;
  ctx.fillText(text, WIDTH / 2, HEIGHT / 2);
  ctx.shadowBlur = 0;

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

function fitFontSize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): number {
  let size = 84;
  ctx.font = `700 ${size}px "Rajdhani", "Inter", sans-serif`;
  while (size > 28 && ctx.measureText(text).width > maxWidth) {
    size -= 4;
    ctx.font = `700 ${size}px "Rajdhani", "Inter", sans-serif`;
  }
  return size;
}
