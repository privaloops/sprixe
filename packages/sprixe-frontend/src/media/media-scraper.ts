/**
 * MediaScraper — background prefetch of every known game's screenshot
 * + marquee into the IDB MediaCache.
 *
 * Runs silently in the background after the browser starts. Walks the
 * catalogue with a small concurrency (default 3) and a breath between
 * batches so we don't hammer ArcadeDB. Each job is a no-op when the
 * cache already holds a blob, so repeat runs cost nothing and can
 * resume a partial scrape after a reload.
 *
 * Future sources (ScreenScraper once devkeys land) can plug into the
 * same queue — PreviewLoader controls the candidate URLs; the scraper
 * only decides order + pacing.
 */

import type { GameEntry } from "../data/games";
import type { PreviewLoader } from "./preview-loader";

type Kind = "screenshot" | "marquee";

interface Job {
  gameId: string;
  system: GameEntry["system"];
  kind: Kind;
}

export interface ScraperProgress {
  total: number;
  done: number;
  failed: number;
}

export interface MediaScraperOptions {
  maxConcurrent?: number;
  /** Delay between batches, in ms. Default 300. */
  batchDelayMs?: number;
  onProgress?: (progress: ScraperProgress) => void;
}

export class MediaScraper {
  private readonly loader: PreviewLoader;
  private readonly maxConcurrent: number;
  private readonly batchDelayMs: number;
  private readonly onProgress: ((p: ScraperProgress) => void) | undefined;

  private queue: Job[] = [];
  private progress: ScraperProgress = { total: 0, done: 0, failed: 0 };
  private running = false;
  private stopped = false;

  constructor(loader: PreviewLoader, options: MediaScraperOptions = {}) {
    this.loader = loader;
    this.maxConcurrent = options.maxConcurrent ?? 3;
    this.batchDelayMs = options.batchDelayMs ?? 300;
    this.onProgress = options.onProgress;
  }

  enqueue(games: readonly GameEntry[]): void {
    for (const game of games) {
      this.queue.push({ gameId: game.id, system: game.system, kind: "screenshot" });
      this.queue.push({ gameId: game.id, system: game.system, kind: "marquee" });
    }
    this.progress.total = this.queue.length + this.progress.done + this.progress.failed;
    this.emit();
  }

  /**
   * Kick the workers if the queue has work and we're not already
   * running. Safe to call multiple times.
   */
  start(): void {
    if (this.running || this.queue.length === 0) return;
    this.running = true;
    this.stopped = false;
    const workers: Promise<void>[] = [];
    for (let i = 0; i < this.maxConcurrent; i++) {
      workers.push(this.worker());
    }
    void Promise.all(workers).finally(() => {
      this.running = false;
    });
  }

  stop(): void {
    this.stopped = true;
  }

  getProgress(): ScraperProgress {
    return { ...this.progress };
  }

  private async worker(): Promise<void> {
    while (!this.stopped) {
      const job = this.queue.shift();
      if (!job) return;
      const candidates = job.kind === "screenshot"
        ? this.loader.screenshotCandidates(job.gameId, job.system)
        : this.loader.marqueeCandidates(job.gameId, job.system);
      const key = this.loader.cacheKey(job.gameId, job.kind);
      const ok = await this.loader.primeImageCache(key, candidates).catch(() => false);
      if (ok) this.progress.done += 1;
      else this.progress.failed += 1;
      this.emit();
      if (this.batchDelayMs > 0) {
        await delay(this.batchDelayMs);
      }
    }
  }

  private emit(): void {
    if (this.onProgress) this.onProgress({ ...this.progress });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
