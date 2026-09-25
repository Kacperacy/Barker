import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../database/migrations/index";
import { insertChatMessages } from "../database/repositories/chatMessages";
import { insertModerationEvent } from "../database/repositories/moderationEvents";
import { recordStreamSample } from "../database/repositories/streams";
import { handleApiRequest } from "./server";

function makeTestDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

async function body(response: Response): Promise<any> {
  return response.json();
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://barker.test${path}`, init);
}

describe("GET /health", () => {
  test("reports that the API is up and whether chat logging is on", async () => {
    const response = await handleApiRequest(request("/health"), {
      db: makeTestDb(),
    });
    expect(response.status).toBe(200);
    // test/setup.ts turns chat logging on for the suite.
    expect(await body(response)).toEqual({ ok: true, chatLogging: true });
  });
});

describe("GET /api/chat/targets", () => {
  test("reports the configured channels, so the front end need not hardcode them", async () => {
    const response = await handleApiRequest(request("/api/chat/targets"), {
      db: makeTestDb(),
    });

    expect(await body(response)).toEqual({
      enabled: true,
      channels: [
        { platform: "twitch", login: "alice" },
        { platform: "kick", login: "alice" },
      ],
    });
  });
});

describe("GET /api/chat/messages", () => {
  const seed = () => {
    const db = makeTestDb();
    insertChatMessages(
      [
        {
          platform: "kick",
          messageId: "m-1",
          broadcasterLogin: "alice",
          sentAt: "2026-01-01T10:00:00.000Z",
          content: "first",
          senderLogin: "bob",
          senderDisplay: "Bob",
          senderColor: "#FF5733",
          badges: ["moderator"],
          senderUserId: "2",
          replyToMessageId: "m-0",
        },
        {
          platform: "twitch",
          messageId: "m-2",
          broadcasterLogin: "alice",
          sentAt: "2026-01-01T11:00:00.000Z",
          content: "second",
          senderLogin: "carol",
        },
      ],
      db,
    );
    return db;
  };

  test("returns newest first with a mapped author object and a total", async () => {
    const response = await handleApiRequest(
      request("/api/chat/messages?platform=twitch&login=alice"),
      { db: seed() },
    );
    expect(response.status).toBe(200);

    const payload = await body(response);
    expect(payload.total).toBe(1);
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]).toEqual({
      platform: "twitch",
      id: "m-2",
      channel: "alice",
      streamId: null,
      offsetSeconds: null,
      sentAt: "2026-01-01T11:00:00.000Z",
      author: {
        id: null,
        login: "carol",
        display: null,
        color: null,
        badges: [],
      },
      content: "second",
      replyTo: null,
      deleted: null,
    });
  });

  test("parses the stored badges JSON back into an array", async () => {
    const response = await handleApiRequest(
      request("/api/chat/messages?platform=kick&login=alice"),
      { db: seed() },
    );

    const payload = await body(response);
    expect(payload.messages[0].author.badges).toEqual(["moderator"]);
    expect(payload.messages[0].author.color).toBe("#FF5733");
    expect(payload.messages[0].replyTo).toBe("m-0");
  });

  test("passes a search query through and clamps the limit", async () => {
    const response = await handleApiRequest(
      request("/api/chat/messages?q=second&limit=9999"),
      { db: seed() },
    );

    const payload = await body(response);
    expect(payload.total).toBe(1);
    expect(payload.limit).toBe(500);
  });
});

describe("GET /api/moderation/events", () => {
  test("returns the events with their target and actor", async () => {
    const db = makeTestDb();
    insertModerationEvent(
      {
        platform: "kick",
        eventId: "e-1",
        broadcasterLogin: "alice",
        action: "timeout",
        createdAt: "2026-01-01T10:00:00.000Z",
        targetLogin: "bob",
        targetDisplay: "Bob",
        targetUserId: "2",
        actorLogin: "mod",
        reason: "caps",
        durationMinutes: 10,
        expiresAt: "2026-01-01T10:10:00.000Z",
      },
      db,
    );

    const response = await handleApiRequest(request("/api/moderation/events"), {
      db,
    });
    const payload = await body(response);

    expect(payload.total).toBe(1);
    expect(payload.events[0]).toEqual({
      platform: "kick",
      id: "e-1",
      channel: "alice",
      streamId: null,
      action: "timeout",
      target: { id: "2", login: "bob", display: "Bob" },
      targetMessageId: null,
      actor: "mod",
      reason: "caps",
      durationMinutes: 10,
      expiresAt: "2026-01-01T10:10:00.000Z",
      createdAt: "2026-01-01T10:00:00.000Z",
    });
  });
});

describe("GET /api/chat/stats", () => {
  test("returns chat and moderation statistics for the window", async () => {
    const db = makeTestDb();
    insertChatMessages(
      [
        {
          platform: "kick",
          messageId: "m-1",
          broadcasterLogin: "alice",
          sentAt: new Date().toISOString(),
          content: "hi",
          senderLogin: "bob",
        },
      ],
      db,
    );
    insertModerationEvent(
      {
        platform: "kick",
        eventId: "e-1",
        broadcasterLogin: "alice",
        action: "ban",
        createdAt: new Date().toISOString(),
        targetLogin: "carol",
      },
      db,
    );

    const response = await handleApiRequest(request("/api/chat/stats?days=7"), {
      db,
    });
    const payload = await body(response);

    expect(payload.windowDays).toBe(7);
    expect(payload.chat.totalMessages).toBe(1);
    expect(payload.chat.byHour).toHaveLength(24);
    expect(payload.moderation.bans).toBe(1);
    expect(payload.moderation.timeouts).toBe(0);
  });
});

describe("routing", () => {
  test("answers an unknown path with 404 JSON", async () => {
    const response = await handleApiRequest(request("/nope"), {
      db: makeTestDb(),
    });
    expect(response.status).toBe(404);
    expect(await body(response)).toEqual({ error: "not found" });
  });

  test("answers an OPTIONS preflight without touching the database", async () => {
    const response = await handleApiRequest(
      request("/api/chat/messages", { method: "OPTIONS" }),
      { db: makeTestDb() },
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("rejects a GET on the webhook path", async () => {
    const response = await handleApiRequest(request("/webhooks/kick"), {
      db: makeTestDb(),
    });
    expect(response.status).toBe(405);
  });

  test("fails the webhook closed when the signing key cannot be fetched", async () => {
    const response = await handleApiRequest(
      request("/webhooks/kick", { method: "POST", body: "{}" }),
      { db: makeTestDb(), kick: { getPublicKey: async () => null } },
    );
    expect(response.status).toBe(503);
  });
});
describe("GET /api/streams", () => {
  test("lists broadcasts with viewers and what happened in chat", async () => {
    const db = makeTestDb();
    for (const [at, viewers] of [
      ["2026-01-01T10:00:00.000Z", 4],
      ["2026-01-01T11:00:00.000Z", 10],
    ] as const) {
      recordStreamSample(
        {
          platform: "kick",
          streamId: "s-1",
          broadcasterLogin: "alice",
          title: "siema",
          category: "Just Chatting",
          startedAt: "2026-01-01T10:00:00.000Z",
          viewers,
          at,
        },
        db,
      );
    }
    insertChatMessages(
      [
        { platform: "kick", messageId: "m-1", broadcasterLogin: "alice", streamId: "s-1", sentAt: "2026-01-01T10:30:00.000Z", content: "a", senderLogin: "bob" },
        { platform: "kick", messageId: "m-2", broadcasterLogin: "alice", streamId: "s-1", sentAt: "2026-01-01T10:31:00.000Z", content: "b", senderLogin: "bob" },
      ],
      db,
    );
    insertModerationEvent(
      { platform: "kick", eventId: "e-1", broadcasterLogin: "alice", streamId: "s-1", action: "ban", createdAt: "2026-01-01T10:40:00.000Z" },
      db,
    );

    const payload = await body(
      await handleApiRequest(request("/api/streams?platform=kick&login=alice"), { db }),
    );
    expect(payload.total).toBe(1);
    expect(payload.streams[0]).toEqual({
      platform: "kick",
      id: "s-1",
      channel: "alice",
      title: "siema",
      category: "Just Chatting",
      startedAt: "2026-01-01T10:00:00.000Z",
      endedAt: null,
      live: true,
      durationSeconds: 3600,
      peakViewers: 10,
      avgViewers: 7,
      messages: 2,
      chatters: 1,
      bans: 1,
      timeouts: 0,
    });

    const samples = await body(
      await handleApiRequest(request("/api/streams/viewers?platform=kick&id=s-1"), { db }),
    );
    expect(samples.samples).toEqual([
      { at: "2026-01-01T10:00:00.000Z", viewers: 4 },
      { at: "2026-01-01T11:00:00.000Z", viewers: 10 },
    ]);
  });

  test("asks for the stream a viewer graph is for", async () => {
    const response = await handleApiRequest(request("/api/streams/viewers?platform=kick"), {
      db: makeTestDb(),
    });
    expect(response.status).toBe(400);
  });
});
