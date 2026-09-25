// Request rate limits, in memory (one process serves everything).
//
// Who a request is from: Barker sits behind nginx-proxy-manager, which appends
// the address it accepted the connection from to X-Forwarded-For, so the LAST
// entry is trustworthy (the "peer": a visitor calling barker.kacperacy.ovh
// directly, or a Vercel edge node relaying the site's /barker proxy). The entry
// before it is the client address that peer claims — Vercel's view of the site
// visitor, or anything a direct caller made up.
//
// So each request is counted twice: per claimed client (normal limits: fair to
// every site visitor behind Vercel's shared edges) and per peer (high limits: a
// direct caller rotating fake client addresses is still capped by its own).

export interface Limit {
  // Requests allowed per window.
  max: number;
  windowMs: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private windows = new Map<string, Window>();
  private lastPrune = 0;

  // Counts the request; returns the seconds to wait when over the limit.
  hit(key: string, limit: Limit, now: number = Date.now()): number | null {
    this.prune(now);
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + limit.windowMs });
      return null;
    }
    current.count += 1;
    if (current.count > limit.max) return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return null;
  }

  private prune(now: number): void {
    if (now - this.lastPrune < 60_000) return;
    this.lastPrune = now;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

export function requesters(request: Request): { client: string; peer: string } {
  const hops = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop !== "");
  const peer = hops[hops.length - 1] ?? "direct";
  const client = hops.length >= 2 ? hops[hops.length - 2]! : peer;
  return { client, peer };
}

export type RequestKind = "auth" | "write" | "report" | "read";

// Per client; the per-peer limit is PEER_FACTOR times these.
export const LIMITS: Record<RequestKind, Limit> = {
  // Starting a login writes a pending-login row.
  auth: { max: 20, windowMs: 10 * 60_000 },
  write: { max: 60, windowMs: 60_000 },
  report: { max: 10, windowMs: 60_000 },
  read: { max: 240, windowMs: 60_000 },
};
const PEER_FACTOR = 20;

export function classify(request: Request, path: string): RequestKind | null {
  // Kick's signed deliveries and the health probe are not throttled.
  if (request.method === "OPTIONS" || path === "/health" || path === "/webhooks/kick") return null;
  if (/^\/auth\/(kick|twitch)\/(start|callback)$/.test(path)) return "auth";
  if (path.endsWith("/report") || path === "/csp-report") return "report";
  if (request.method !== "GET" && request.method !== "HEAD") return "write";
  return "read";
}

export const defaultLimiter = new RateLimiter();

// Null when the request may proceed, else a 429 to send.
export function throttle(
  request: Request,
  path: string,
  limiter: RateLimiter = defaultLimiter,
  now: number = Date.now(),
): Response | null {
  const kind = classify(request, path);
  if (!kind) return null;
  const { client, peer } = requesters(request);
  const limit = LIMITS[kind];
  const wait =
    limiter.hit(`${kind}:c:${client}`, limit, now) ??
    limiter.hit(`${kind}:p:${peer}`, { max: limit.max * PEER_FACTOR, windowMs: limit.windowMs }, now);
  if (wait === null) return null;
  return new Response(JSON.stringify({ error: "Za dużo zapytań — spróbuj za chwilę." }), {
    status: 429,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Retry-After": String(wait),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
