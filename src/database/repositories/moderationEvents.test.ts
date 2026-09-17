import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../migrations/index";
import {
  insertModerationEvent,
  listModerationEvents,
  MAX_MODERATION_PAGE,
} from "./moderationEvents";

function makeTestDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

function event(over: Record<string, unknown> = {}) {
  return {
    platform: "kick" as const,
    eventId: "evt-1",
    broadcasterLogin: "alice",
    action: "ban" as const,
    createdAt: "2026-01-01T10:00:00.000Z",
    ...over,
  };
}

describe("insertModerationEvent", () => {
  test("stores the event and reports it as new", () => {
    const db = makeTestDb();
    expect(insertModerationEvent(event(), db)).toBe(true);

    const page = listModerationEvents({}, db);
    expect(page.total).toBe(1);
    expect(page.events[0]).toMatchObject({
      platform: "kick",
      event_id: "evt-1",
      action: "ban",
      broadcaster_login: "alice",
    });
  });

  test("reports a redelivery as not new", () => {
    const db = makeTestDb();
    insertModerationEvent(event(), db);
    expect(insertModerationEvent(event(), db)).toBe(false);
    expect(listModerationEvents({}, db).total).toBe(1);
  });

  test("keeps the timeout length and expiry", () => {
    const db = makeTestDb();
    insertModerationEvent(
      event({
        action: "timeout",
        durationMinutes: 10,
        expiresAt: "2026-01-01T10:10:00.000Z",
        reason: "caps",
        actorLogin: "mod",
        targetLogin: "bob",
      }),
      db,
    );

    const row = listModerationEvents({}, db).events[0];
    expect(row).toMatchObject({
      action: "timeout",
      duration_minutes: 10,
      expires_at: "2026-01-01T10:10:00.000Z",
      reason: "caps",
      actor_login: "mod",
      target_login: "bob",
    });
  });

  test("stores a channel-wide action that has no target", () => {
    const db = makeTestDb();
    insertModerationEvent(event({ action: "chat_clear", eventId: "clear-1" }), db);

    expect(listModerationEvents({}, db).events[0]).toMatchObject({
      action: "chat_clear",
      target_login: null,
      target_user_id: null,
    });
  });
});

describe("listModerationEvents", () => {
  test("returns newest first and filters by action, channel and target", () => {
    const db = makeTestDb();
    insertModerationEvent(
      event({ eventId: "e1", action: "ban", createdAt: "2026-01-01T10:00:00.000Z", targetLogin: "bob" }),
      db,
    );
    insertModerationEvent(
      event({
        eventId: "e2",
        action: "timeout",
        createdAt: "2026-01-02T10:00:00.000Z",
        targetLogin: "carol",
      }),
      db,
    );
    insertModerationEvent(
      event({
        platform: "twitch",
        eventId: "e3",
        action: "ban",
        createdAt: "2026-01-03T10:00:00.000Z",
        targetLogin: "dave",
      }),
      db,
    );

    expect(listModerationEvents({}, db).events.map((row) => row.event_id)).toEqual([
      "e3",
      "e2",
      "e1",
    ]);
    expect(listModerationEvents({ action: "ban" }, db).total).toBe(2);
    expect(listModerationEvents({ platform: "kick", login: "alice" }, db).total).toBe(2);
    expect(listModerationEvents({ target: "CAROL" }, db).total).toBe(1);
  });

  test("clamps the page size instead of trusting the caller", () => {
    const db = makeTestDb();
    expect(listModerationEvents({ limit: 10_000 }, db).limit).toBe(MAX_MODERATION_PAGE);
  });
});