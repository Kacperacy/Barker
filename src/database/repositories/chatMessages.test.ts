import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../migrations/index";
import {
  deleteChatMessagesBefore,
  insertChatMessages,
  listChatMessages,
  MAX_CHAT_PAGE,
} from "./chatMessages";

function makeTestDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

function message(over: Record<string, unknown> = {}) {
  return {
    platform: "twitch" as const,
    messageId: "m-1",
    broadcasterLogin: "alice",
    sentAt: "2026-01-01T10:00:00.000Z",
    content: "hello",
    ...over,
  };
}

describe("insertChatMessages", () => {
  test("stores a message and reports it as new", () => {
    const db = makeTestDb();
    expect(insertChatMessages([message()], db)).toBe(1);

    const page = listChatMessages({}, db);
    expect(page.total).toBe(1);
    expect(page.messages[0]).toMatchObject({
      platform: "twitch",
      message_id: "m-1",
      broadcaster_login: "alice",
      content: "hello",
    });
  });

  // Both platforms are at-least-once, so the same message can arrive twice.
  test("ignores a redelivered message id", () => {
    const db = makeTestDb();
    expect(insertChatMessages([message()], db)).toBe(1);
    expect(insertChatMessages([message()], db)).toBe(0);
    expect(listChatMessages({}, db).total).toBe(1);
  });

  test("counts only the new rows of a batch", () => {
    const db = makeTestDb();
    const inserted = insertChatMessages(
      [message({ messageId: "m-1" }), message({ messageId: "m-2" }), message({ messageId: "m-1" })],
      db,
    );
    expect(inserted).toBe(2);
  });

  test("keeps badges as JSON and the stream it belongs to", () => {
    const db = makeTestDb();
    insertChatMessages(
      [
        message({
          badges: ["moderator", "subscriber"],
          streamId: "stream-9",
          streamStartedAt: "2026-01-01T09:00:00.000Z",
          offsetSeconds: 3600,
        }),
      ],
      db,
    );

    const row = listChatMessages({}, db).messages[0];
    expect(row?.badges).toBe('["moderator","subscriber"]');
    expect(row?.stream_id).toBe("stream-9");
    expect(row?.offset_seconds).toBe(3600);
  });
});

describe("listChatMessages", () => {
  test("returns the newest first and pages with an offset", () => {
    const db = makeTestDb();
    insertChatMessages(
      [
        message({ messageId: "m-1", sentAt: "2026-01-01T10:00:00.000Z" }),
        message({ messageId: "m-2", sentAt: "2026-01-01T11:00:00.000Z" }),
        message({ messageId: "m-3", sentAt: "2026-01-01T12:00:00.000Z" }),
      ],
      db,
    );

    const firstPage = listChatMessages({ limit: 2 }, db);
    expect(firstPage.messages.map((row) => row.message_id)).toEqual(["m-3", "m-2"]);
    expect(firstPage.total).toBe(3);

    const secondPage = listChatMessages({ limit: 2, offset: 2 }, db);
    expect(secondPage.messages.map((row) => row.message_id)).toEqual(["m-1"]);
  });

  test("filters by author, channel and text", () => {
    const db = makeTestDb();
    insertChatMessages(
      [
        message({ messageId: "a", senderLogin: "bob", content: "50% off everything" }),
        message({ messageId: "b", senderLogin: "carol", content: "hello there" }),
        message({ messageId: "c", broadcasterLogin: "dave", senderLogin: "bob", content: "hello" }),
      ],
      db,
    );

    expect(listChatMessages({ author: "BOB" }, db).total).toBe(2);
    expect(listChatMessages({ platform: "twitch", login: "alice" }, db).total).toBe(2);
    expect(listChatMessages({ q: "hello" }, db).total).toBe(2);
    // `%` is a literal here, not a wildcard, so it cannot match everything.
    expect(listChatMessages({ q: "%" }, db).total).toBe(1);
  });

  test("finds an author by display name or by either spelling of a Kick login", () => {
    const db = makeTestDb();
    insertChatMessages(
      [
        message({
          messageId: "a",
          platform: "kick",
          broadcasterLogin: "klaun-0k",
          senderLogin: "szachowy-motor-1996",
          senderDisplay: "Szachowy_Motor_1996",
        }),
        message({ messageId: "b", senderLogin: "carol", senderDisplay: "Carol" }),
      ],
      db,
    );

    expect(listChatMessages({ author: "Szachowy_Motor_1996" }, db).total).toBe(1);
    expect(listChatMessages({ author: "szachowy-motor-1996" }, db).total).toBe(1);
    expect(listChatMessages({ author: "CAROL" }, db).total).toBe(1);
    expect(listChatMessages({ author: "szachowy" }, db).total).toBe(0);
  });

  test("normalizes a Kick channel filter to the stored slug", () => {
    const db = makeTestDb();
    insertChatMessages(
      [message({ platform: "kick", broadcasterLogin: "some-streamer", messageId: "k-1" })],
      db,
    );

    expect(listChatMessages({ platform: "kick", login: "some_streamer" }, db).total).toBe(1);
  });

  test("clamps the page size instead of trusting the caller", () => {
    const db = makeTestDb();
    const page = listChatMessages({ limit: 10_000 }, db);
    expect(page.limit).toBe(MAX_CHAT_PAGE);
  });
});

describe("deleteChatMessagesBefore", () => {
  test("removes only what is older than the cutoff", () => {
    const db = makeTestDb();
    insertChatMessages(
      [
        message({ messageId: "old", sentAt: "2026-01-01T00:00:00.000Z" }),
        message({ messageId: "new", sentAt: "2026-02-01T00:00:00.000Z" }),
      ],
      db,
    );

    expect(deleteChatMessagesBefore("2026-01-15T00:00:00.000Z", db)).toBe(1);
    expect(listChatMessages({}, db).messages.map((row) => row.message_id)).toEqual(["new"]);
  });
});