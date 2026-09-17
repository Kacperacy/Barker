import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../migrations/index";
import { insertChatMessages } from "./chatMessages";
import { insertModerationEvent } from "./moderationEvents";
import { chatStats, moderationStats } from "./chatStats";

function makeTestDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

// Relative to now, so the default 30-day window can be exercised without
// freezing the clock.
function daysAgo(days: number, hour = 12): string {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

function message(over: Record<string, unknown> = {}) {
  return {
    platform: "twitch" as const,
    messageId: `m-${Math.random().toString(36).slice(2)}`,
    broadcasterLogin: "alice",
    sentAt: daysAgo(0),
    content: "hello",
    senderLogin: "bob",
    senderDisplay: "Bob",
    ...over,
  };
}

describe("chatStats", () => {
  test("counts messages, chatters and the busiest days and hours", () => {
    const db = makeTestDb();
    insertChatMessages(
      [
        message({ sentAt: daysAgo(1, 10) }),
        message({ sentAt: daysAgo(1, 10) }),
        message({ sentAt: daysAgo(1, 22), senderLogin: "carol", senderDisplay: "Carol" }),
        message({ sentAt: daysAgo(10, 10) }),
        // Outside the default 30-day window.
        message({ sentAt: daysAgo(60, 10), senderLogin: "dave", senderDisplay: "Dave" }),
      ],
      db,
    );

    const stats = chatStats({}, db);
    expect(stats.totalMessages).toBe(4);
    expect(stats.uniqueChatters).toBe(2);
    expect(stats.byDay).toHaveLength(2);
    expect(stats.byHour).toHaveLength(24);
    expect(stats.byHour.reduce((sum, value) => sum + value, 0)).toBe(4);
    expect(stats.byHour[10]).toBe(3);
    expect(stats.topChatters[0]).toEqual({ login: "bob", display: "Bob", messages: 3 });
    expect(stats.firstMessageAt).not.toBeNull();
  });

  test("keeps everything when the window is disabled", () => {
    const db = makeTestDb();
    insertChatMessages([message({ sentAt: daysAgo(60) })], db);

    expect(chatStats({ days: 0 }, db).totalMessages).toBe(1);
    expect(chatStats({ days: 1 }, db).totalMessages).toBe(0);
  });

  test("filters by channel, normalizing a Kick slug", () => {
    const db = makeTestDb();
    insertChatMessages(
      [
        message({ platform: "kick", broadcasterLogin: "some-streamer" }),
        message({ platform: "twitch", broadcasterLogin: "alice" }),
      ],
      db,
    );

    expect(chatStats({ platform: "kick", login: "some_streamer" }, db).totalMessages).toBe(1);
  });

  test("ignores messages with no author when ranking chatters", () => {
    const db = makeTestDb();
    insertChatMessages([message({ senderLogin: null, senderDisplay: null })], db);

    const stats = chatStats({}, db);
    expect(stats.totalMessages).toBe(1);
    expect(stats.topChatters).toEqual([]);
  });
});

describe("moderationStats", () => {
  const event = (over: Record<string, unknown> = {}) => ({
    platform: "kick" as const,
    eventId: `e-${Math.random().toString(36).slice(2)}`,
    broadcasterLogin: "alice",
    action: "ban" as const,
    createdAt: daysAgo(1),
    ...over,
  });

  test("separates bans from timeouts and ranks targets and actors", () => {
    const db = makeTestDb();
    insertModerationEvent(event({ targetLogin: "bob", actorLogin: "mod" }), db);
    insertModerationEvent(
      event({ action: "timeout", targetLogin: "bob", actorLogin: "mod", durationMinutes: 10 }),
      db,
    );
    insertModerationEvent(
      event({ action: "timeout", targetLogin: "carol", actorLogin: "owner" }),
      db,
    );
    // A message deletion is neither a ban nor a timeout, and must not be counted
    // as one.
    insertModerationEvent(event({ action: "message_delete", targetLogin: "dave" }), db);

    const stats = moderationStats({}, db);
    expect(stats.total).toBe(4);
    expect(stats.bans).toBe(1);
    expect(stats.timeouts).toBe(2);
    expect(stats.byDay).toHaveLength(1);
    expect(stats.byDay[0]).toMatchObject({ bans: 1, timeouts: 2 });
    expect(stats.topTargets[0]).toEqual({ login: "bob", count: 2 });
    expect(stats.topActors[0]).toEqual({ login: "mod", count: 2 });
  });

  test("drops everything outside the window", () => {
    const db = makeTestDb();
    insertModerationEvent(event({ createdAt: daysAgo(90) }), db);

    expect(moderationStats({ days: 30 }, db).total).toBe(0);
    expect(moderationStats({ days: 0 }, db).total).toBe(1);
  });
});