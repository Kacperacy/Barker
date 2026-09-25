import { describe, expect, test } from "bun:test";
import { RateLimiter, requesters, throttle } from "./rateLimit";
import { safeReturnPath } from "../auth/oauth";

const request = (path: string, xff?: string, method = "GET") =>
  new Request(`http://barker.test${path}`, { method, headers: xff ? { "x-forwarded-for": xff } : {} });

describe("requesters", () => {
  test("trusts the proxy's last hop as the peer and takes the client from before it", () => {
    expect(requesters(request("/", "203.0.113.5, 76.76.21.1"))).toEqual({ client: "203.0.113.5", peer: "76.76.21.1" });
    expect(requesters(request("/", "198.51.100.9"))).toEqual({ client: "198.51.100.9", peer: "198.51.100.9" });
    expect(requesters(request("/"))).toEqual({ client: "direct", peer: "direct" });
  });
});

describe("throttle", () => {
  test("caps login starts per client and answers 429 with Retry-After", () => {
    const limiter = new RateLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 20; i++) expect(throttle(request("/auth/kick/start", "1.1.1.1, 9.9.9.9"), "/auth/kick/start", limiter, now)).toBeNull();
    const refused = throttle(request("/auth/kick/start", "1.1.1.1, 9.9.9.9"), "/auth/kick/start", limiter, now);
    expect(refused?.status).toBe(429);
    expect(Number(refused?.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another visitor behind the same Vercel edge is not affected.
    expect(throttle(request("/auth/kick/start", "2.2.2.2, 9.9.9.9"), "/auth/kick/start", limiter, now)).toBeNull();
    // The window passes.
    expect(throttle(request("/auth/kick/start", "1.1.1.1, 9.9.9.9"), "/auth/kick/start", limiter, now + 11 * 60_000)).toBeNull();
  });

  test("a direct caller faking client addresses is still capped by its own address", () => {
    const limiter = new RateLimiter();
    let refused = 0;
    for (let i = 0; i < 2000; i++) {
      if (throttle(request("/api/highlights", `10.0.${i >> 8}.${i & 255}, 6.6.6.6`, "POST"), "/api/highlights", limiter, 5)) refused++;
    }
    expect(refused).toBe(2000 - 60 * 20);
  });

  test("leaves Kick's webhooks and the health probe alone", () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 500; i++) {
      expect(throttle(request("/webhooks/kick", "1.1.1.1", "POST"), "/webhooks/kick", limiter, 5)).toBeNull();
    }
  });
});

describe("safeReturnPath", () => {
  test("keeps same-site paths and refuses anything a browser could turn into another site", () => {
    expect(safeReturnPath("/vods?sort=chat")).toBe("/vods?sort=chat");
    expect(safeReturnPath("/")).toBe("/");
    for (const bad of ["//evil.test", "/\\\\evil.test", "/\t/evil.test", "/\n/evil.test", "https://evil.test", "evil", null, "/a b"]) {
      expect(safeReturnPath(bad)).toBe("/");
    }
  });
});
