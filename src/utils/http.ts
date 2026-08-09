export interface RateLimitWindow {
  maxRequests: number;
  windowMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RateLimiter {
  private windows: RateLimitWindow[];
  private timestamps: number[][];

  constructor(windows: RateLimitWindow[]) {
    this.windows = windows;
    this.timestamps = windows.map(() => []);
  }

  private msUntilSlotFree(now: number): number {
    let waitMs = 0;

    for (let i = 0; i < this.windows.length; i++) {
      const window = this.windows[i]!;
      const times = this.timestamps[i]!;

      while (times.length > 0 && now - times[0]! >= window.windowMs) {
        times.shift();
      }

      if (times.length >= window.maxRequests) {
        const timeUntilOldestExpires = times[0]! + window.windowMs - now;
        waitMs = Math.max(waitMs, timeUntilOldestExpires);
      }
    }

    return waitMs;
  }

  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      const waitMs = this.msUntilSlotFree(now);

      if (waitMs <= 0) {
        const recordedAt = Date.now();
        for (const times of this.timestamps) {
          times.push(recordedAt);
        }
        return;
      }

      await sleep(waitMs);
    }
  }
}

export interface FetchWithRetryOptions {
  retries?: number;
  baseDelayMs?: number;
  rateLimiter?: RateLimiter;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const { retries = 3, baseDelayMs = 500, rateLimiter } = options;

  let attempt = 0;

  while (true) {
    if (rateLimiter) await rateLimiter.acquire();

    const res = await fetch(url, init);

    const isRetryableStatus = res.status === 429 || res.status >= 500;
    if (!isRetryableStatus || attempt >= retries) {
      return res;
    }

    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader
      ? Number(retryAfterHeader) * 1000
      : baseDelayMs * 2 ** attempt;

    await sleep(retryAfterMs);
    attempt++;
  }
}
