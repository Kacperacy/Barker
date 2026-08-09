import { afterEach, describe, expect, test } from "bun:test";
import { fetchWithRetry, RateLimiter } from "./http";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({}), { status, headers });
}

describe("fetchWithRetry", () => {
  test("returns immediately on a successful first attempt", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return jsonResponse(200);
    }) as unknown as typeof fetch;

    const res = await fetchWithRetry("https://example.com", {});
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
  });

  test("retries on 429 then succeeds", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return jsonResponse(429, { "retry-after": "0" });
      return jsonResponse(200);
    }) as unknown as typeof fetch;

    const res = await fetchWithRetry(
      "https://example.com",
      {},
      { baseDelayMs: 1 },
    );
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  test("retries on 5xx then succeeds", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls < 3) return jsonResponse(503);
      return jsonResponse(200);
    }) as unknown as typeof fetch;

    const res = await fetchWithRetry(
      "https://example.com",
      {},
      { baseDelayMs: 1 },
    );
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });

  test("gives up after exhausting retries and returns the last failed response", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return jsonResponse(500);
    }) as unknown as typeof fetch;

    const res = await fetchWithRetry(
      "https://example.com",
      {},
      { retries: 2, baseDelayMs: 1 },
    );
    expect(res.status).toBe(500);
    expect(calls).toBe(3); // initial attempt + 2 retries
  });

  test("does not retry on non-retryable client errors (e.g. 404)", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return jsonResponse(404);
    }) as unknown as typeof fetch;

    const res = await fetchWithRetry("https://example.com", {});
    expect(res.status).toBe(404);
    expect(calls).toBe(1);
  });

  test("respects the Retry-After header over exponential backoff", async () => {
    let calls = 0;
    const timestamps: number[] = [];
    globalThis.fetch = (async () => {
      timestamps.push(Date.now());
      calls++;
      if (calls === 1) return jsonResponse(429, { "retry-after": "0.05" });
      return jsonResponse(200);
    }) as unknown as typeof fetch;

    await fetchWithRetry("https://example.com", {}, { baseDelayMs: 5000 });
    expect(calls).toBe(2);
    const elapsed = timestamps[1]! - timestamps[0]!;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("RateLimiter", () => {
  test("allows requests up to the limit without delay", async () => {
    const limiter = new RateLimiter([{ maxRequests: 3, windowMs: 1000 }]);
    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });

  test("delays the request that exceeds the window limit", async () => {
    const limiter = new RateLimiter([{ maxRequests: 2, windowMs: 100 }]);
    await limiter.acquire();
    await limiter.acquire();

    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  test("enforces the most restrictive of multiple windows", async () => {
    const limiter = new RateLimiter([
      { maxRequests: 5, windowMs: 1000 },
      { maxRequests: 1, windowMs: 100 },
    ]);
    await limiter.acquire();

    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });
});
