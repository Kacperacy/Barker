import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../database/migrations/index";
import { insertModerationEvent } from "../database/repositories/moderationEvents";
import { resetLiveBroadcasts, setLiveBroadcast } from "../chat/live";
import { createSession, upsertUser } from "../auth/accounts";
import { handleApiRequest } from "./server";
import { RateLimiter } from "./rateLimit";

const SITE = "https://www.klaun.live";
const NOW = new Date("2026-09-24T18:00:00.000Z");
let clock = NOW;
let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
  resetLiveBroadcasts();
  clock = NOW;
});

function user(login: string, platform: "kick" | "twitch" = "kick") {
  const row = upsertUser(
    { platform, platformUserId: `id-${login}`, login, display: login.toUpperCase(), avatar: null },
    db,
  );
  return { row, cookie: `klaun_session=${createSession(row.id, db, clock)}` };
}

async function call(
  path: string,
  init: { method?: string; cookie?: string; body?: unknown; origin?: string | null } = {},
  fetchImpl?: typeof fetch,
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin !== null && init.method && init.method !== "GET") headers.origin = init.origin ?? SITE;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const response = await handleApiRequest(
    new Request(`http://barker.test${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: "manual",
    }),
    { db, fetchImpl, now: () => clock, limiter: new RateLimiter() },
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

const later = (seconds: number) => {
  clock = new Date(clock.getTime() + seconds * 1000);
};

const live = () => setLiveBroadcast("kick", "alice", { streamId: "s-1", startedAt: "2026-09-24T17:00:00.000Z" });
const channel = { platform: "kick", login: "alice" };

describe("login", () => {
  test("Kick: PKCE authorize, code exchange, session cookie, back to the page", async () => {
    const start = await handleApiRequest(
      new Request("http://barker.test/auth/kick/start?return=/vods"),
      { db, now: () => clock, limiter: new RateLimiter() },
    );
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get("location")!);
    expect(authorize.origin + authorize.pathname).toBe("https://id.kick.com/oauth/authorize");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${SITE}/barker/auth/kick/callback`);

    const calls: string[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(String(input));
      if (String(input).includes("/oauth/token")) {
        expect(String(init?.body)).toContain("code_verifier=");
        return new Response(JSON.stringify({ access_token: "t" }));
      }
      return new Response(JSON.stringify({ data: [{ user_id: 7, name: "Some_User", profile_picture: "p.png" }] }));
    }) as typeof fetch;

    const state = authorize.searchParams.get("state")!;
    const callback = await handleApiRequest(
      new Request(`http://barker.test/auth/kick/callback?code=c&state=${state}`),
      { db, fetchImpl: fakeFetch, now: () => clock, limiter: new RateLimiter() },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/vods");
    const cookie = callback.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    const me = await call("/api/me", { cookie: cookie.split(";")[0] });
    expect(me.body.user).toMatchObject({ platform: "kick", login: "some-user", display: "Some_User", role: "user" });

    // The state is single use.
    const replay = await handleApiRequest(
      new Request(`http://barker.test/auth/kick/callback?code=c&state=${state}`),
      { db, fetchImpl: fakeFetch, now: () => clock, limiter: new RateLimiter() },
    );
    expect(replay.headers.get("location")).toBe("/?login=error");
  });

  test("never returns to another site", async () => {
    const start = await handleApiRequest(
      new Request("http://barker.test/auth/twitch/start?return=//evil.test"),
      { db, now: () => clock, limiter: new RateLimiter() },
    );
    const state = new URL(start.headers.get("location")!).searchParams.get("state");
    const row = db.query("SELECT return_to FROM oauth_states WHERE state = ?1").get(state) as { return_to: string };
    expect(row.return_to).toBe("/");
  });
});

describe("highlights", () => {
  test("a live mark lands the embed delay before the click and is public at once", async () => {
    live();
    const bob = user("bob");
    const created = await call("/api/highlights", { method: "POST", cookie: bob.cookie, body: { channel, kind: "hype", note: "ale akcja" } });
    expect(created.status).toBe(201);

    const moments = await call(
      `/api/highlights?platform=kick&login=alice&from=2026-09-24T17:00:00Z&to=2026-09-24T19:00:00Z`,
    );
    expect(moments.body.moments).toEqual([
      {
        at: "2026-09-24T17:59:40.000Z",
        count: 1,
        kind: "hype",
        marks: [{ id: created.body.id, kind: "hype", note: "ale akcja", by: { display: "BOB", platform: "kick" }, mine: false }],
      },
    ]);
  });

  test("marks from different people close together are one moment", async () => {
    live();
    await call("/api/highlights", { method: "POST", cookie: user("bob").cookie, body: { channel } });
    later(40);
    await call("/api/highlights", { method: "POST", cookie: user("carol").cookie, body: { channel, back: 30 } });
    later(300);
    await call("/api/highlights", { method: "POST", cookie: user("dave").cookie, body: { channel } });

    const { body } = await call(`/api/highlights?platform=kick&login=alice&from=2026-09-24T17:00:00Z&to=2026-09-24T19:00:00Z`);
    expect(body.moments.map((moment: { count: number }) => moment.count)).toEqual([2, 1]);
  });

  test("refuses marks from other sites, while offline, too often, and bad notes", async () => {
    const bob = user("bob");
    expect((await call("/api/highlights", { method: "POST", cookie: bob.cookie, body: { channel } })).status).toBe(409);
    live();
    expect((await call("/api/highlights", { method: "POST", cookie: bob.cookie, body: { channel }, origin: "https://evil.test" })).status).toBe(403);
    expect((await call("/api/highlights", { method: "POST", body: { channel } })).status).toBe(401);
    expect((await call("/api/highlights", { method: "POST", cookie: bob.cookie, body: { channel, note: "wejdź na klaun.xyz" } })).body.error).toContain("linków");
    expect((await call("/api/highlights", { method: "POST", cookie: bob.cookie, body: { channel, note: "ZAKAZANE słowo" } })).status).toBe(400);
    expect((await call("/api/highlights", { method: "POST", cookie: bob.cookie, body: { channel } })).status).toBe(201);
    expect((await call("/api/highlights", { method: "POST", cookie: bob.cookie, body: { channel } })).status).toBe(429);
  });

  test("carries a chat ban over, and lets a timeout run out", async () => {
    live();
    const bob = user("bob");
    insertModerationEvent(
      { platform: "kick", eventId: "t-1", broadcasterLogin: "alice", action: "timeout", targetLogin: "bob", expiresAt: "2026-09-24T18:10:00.000Z", createdAt: "2026-09-24T17:55:00.000Z" },
      db,
    );
    expect((await call("/api/highlights", { method: "POST", cookie: bob.cookie, body: { channel } })).status).toBe(403);
    later(15 * 60);
    live();
    expect((await call("/api/highlights", { method: "POST", cookie: bob.cookie, body: { channel } })).status).toBe(201);
  });

  test("three reports hide a mark until a moderator restores it", async () => {
    live();
    const { body } = await call("/api/highlights", { method: "POST", cookie: user("bob").cookie, body: { channel, note: "spam" } });
    for (const name of ["r1", "r2", "r3"]) {
      await call(`/api/highlights/${body.id}/report`, { method: "POST", cookie: user(name).cookie, body: { reason: "spam" } });
    }
    const range = `/api/highlights?platform=kick&login=alice&from=2026-09-24T17:00:00Z&to=2026-09-24T19:00:00Z`;
    expect((await call(range)).body.moments).toEqual([]);

    const admin = user("boss");
    const queue = await call("/api/mod/highlights?status=reported", { cookie: admin.cookie });
    expect(queue.body.highlights[0]).toMatchObject({ id: body.id, hidden: true, openReports: 3, reportReasons: ["spam", "spam", "spam"] });

    await call(`/api/mod/highlights/${body.id}`, { method: "POST", cookie: admin.cookie, body: { action: "restore" } });
    expect((await call(range)).body.moments).toHaveLength(1);
    expect((await call("/api/mod/highlights?status=reported", { cookie: admin.cookie })).body.highlights).toEqual([]);
  });
});

describe("moderation", () => {
  test("only moderators moderate; a mute stops marking and can hide past marks", async () => {
    live();
    const bob = user("bob");
    const carol = user("carol");
    const admin = user("boss");
    const { body } = await call("/api/highlights", { method: "POST", cookie: bob.cookie, body: { channel } });

    expect((await call(`/api/mod/highlights/${body.id}`, { method: "POST", cookie: carol.cookie, body: { action: "hide" } })).status).toBe(403);

    // The admin makes carol a moderator; carol mutes bob and hides his marks.
    await call(`/api/mod/users/${carol.row.id}/role`, { method: "POST", cookie: admin.cookie, body: { mod: true } });
    const muted = await call(`/api/mod/users/${bob.row.id}/mute`, {
      method: "POST",
      cookie: carol.cookie,
      body: { minutes: 60, reason: "spam", hideMarks: true },
    });
    expect(muted.body).toEqual({ ok: true, hidden: 1 });

    later(60);
    const refused = await call("/api/highlights", { method: "POST", cookie: bob.cookie, body: { channel } });
    expect(refused.status).toBe(403);
    expect((await call("/api/me", { cookie: bob.cookie })).body.user.muted.reason).toBe("spam");

    // A mod cannot sanction the admin, nor another mod; only the admin sees the log.
    expect((await call(`/api/mod/users/${admin.row.id}/mute`, { method: "POST", cookie: carol.cookie, body: { minutes: 5 } })).status).toBe(403);
    expect((await call("/api/mod/log", { cookie: carol.cookie })).status).toBe(403);
    const log = await call("/api/mod/log", { cookie: admin.cookie });
    expect(log.body.actions.map((entry: { action: string }) => entry.action)).toEqual(["user.mute", "user.grant_mod"]);
  });
});

describe("abuse limits", () => {
  test("a viewer's reports are capped per day, and a blocked viewer cannot report", async () => {
    live();
    const marks: number[] = [];
    for (let i = 0; i < 21; i++) {
      const author = user(`author${i}`);
      const { body } = await call("/api/highlights", { method: "POST", cookie: author.cookie, body: { channel } });
      marks.push(body.id);
    }
    const reporter = user("reporter");
    for (let i = 0; i < 20; i++) {
      expect((await call(`/api/highlights/${marks[i]}/report`, { method: "POST", cookie: reporter.cookie, body: {} })).status).toBe(200);
    }
    expect((await call(`/api/highlights/${marks[20]}/report`, { method: "POST", cookie: reporter.cookie, body: {} })).status).toBe(429);

    const admin = user("boss");
    const muted = user("muted");
    await call(`/api/mod/users/${muted.row.id}/mute`, { method: "POST", cookie: admin.cookie, body: { minutes: 60 } });
    expect((await call(`/api/highlights/${marks[0]}/report`, { method: "POST", cookie: muted.cookie, body: {} })).status).toBe(403);
  });

  test("refuses a moments window wider than 62 days", async () => {
    const res = await call("/api/highlights?platform=kick&login=alice&from=2026-01-01T00:00:00Z&to=2026-09-01T00:00:00Z");
    expect(res.status).toBe(400);
  });

  test("drops expired sessions when someone logs in", async () => {
    const old = user("old");
    db.query("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ?1").run(old.row.id);
    const start = await handleApiRequest(new Request("http://barker.test/auth/kick/start"), { db, now: () => clock, limiter: new RateLimiter() });
    const state = new URL(start.headers.get("location")!).searchParams.get("state");
    const fakeFetch = (async (input: string | URL | Request) =>
      String(input).includes("/oauth/token")
        ? new Response(JSON.stringify({ access_token: "t" }))
        : new Response(JSON.stringify({ data: [{ user_id: 1, name: "New" }] }))) as typeof fetch;
    await handleApiRequest(new Request(`http://barker.test/auth/kick/callback?code=c&state=${state}`), {
      db,
      fetchImpl: fakeFetch,
      now: () => clock,
      limiter: new RateLimiter(),
    });
    const left = db.query("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?1").get(old.row.id) as { n: number };
    expect(left.n).toBe(0);
  });
});
