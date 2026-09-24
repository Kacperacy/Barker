import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runMigrations } from "../database/migrations/index";
import { db } from "../database/connection";
import { insertChatMessages, listChatMessages } from "../database/repositories/chatMessages";
import { listModerationEvents } from "../database/repositories/moderationEvents";
import { stopChatLogging } from "../chat/ingest";
import {
  handleKickSocketEvent,
  startKickChatSocket,
  stopKickChatSocket,
  type KickSocketLike,
} from "./chatSocket";

// Payloads as Kick's chat socket sends them: `data` is a JSON string.
const AT = "2026-09-24T18:30:00.000Z";

runMigrations();

beforeEach(() => {
  stopChatLogging();
  db.query("DELETE FROM chat_messages").run();
  db.query("DELETE FROM moderation_events").run();
});

describe("handleKickSocketEvent", () => {
  test("stores a deletion against the message and its sender", () => {
    insertChatMessages(
      [
        {
          platform: "kick",
          messageId: "msg-1",
          broadcasterLogin: "alice",
          sentAt: "2026-09-24T18:29:00.000Z",
          content: "bad words",
          senderUserId: "7",
          senderLogin: "troll",
          senderDisplay: "Troll",
        },
      ],
      db,
    );

    const data = JSON.stringify({ id: "evt-1", message: { id: "msg-1" }, aiModerated: false });
    expect(handleKickSocketEvent("alice", "App\\Events\\MessageDeletedEvent", data, AT)).toBe(
      "message_delete",
    );

    expect(listModerationEvents({}, db).events[0]).toMatchObject({
      platform: "kick",
      action: "message_delete",
      event_id: "delete:msg-1",
      target_message_id: "msg-1",
      target_login: "troll",
      target_display: "Troll",
      created_at: AT,
    });
    // The log itself now carries the deletion on the message.
    expect(listChatMessages({}, db).messages[0]).toMatchObject({
      message_id: "msg-1",
      deleted_at: AT,
      deleted_by: null,
    });
  });

  test("counts a redelivered deletion once", () => {
    const data = JSON.stringify({ id: "evt-1", message: { id: "msg-9" } });
    handleKickSocketEvent("alice", "App\\Events\\MessageDeletedEvent", data, AT);
    handleKickSocketEvent("alice", "App\\Events\\MessageDeletedEvent", data, AT);
    expect(listModerationEvents({}, db).total).toBe(1);
  });

  test("stores an unban with who lifted it", () => {
    const data = JSON.stringify({
      id: "u-1",
      user: { id: 7, username: "Some_User", slug: "some-user" },
      unbanned_by: { id: 1, username: "Mod", slug: "mod" },
      permanent: true,
    });
    expect(handleKickSocketEvent("alice", "App\\Events\\UserUnbannedEvent", data, AT)).toBe("unban");
    expect(listModerationEvents({}, db).events[0]).toMatchObject({
      action: "unban",
      target_login: "some-user",
      target_display: "Some_User",
      actor_login: "mod",
    });
  });

  test("stores a chat clear", () => {
    expect(
      handleKickSocketEvent("alice", "App\\Events\\ChatroomClearEvent", JSON.stringify({ id: "c-1" }), AT),
    ).toBe("chat_clear");
    expect(listModerationEvents({}, db).events[0]).toMatchObject({ action: "chat_clear" });
  });

  test("leaves messages and bans to the webhooks, and ignores what it cannot read", () => {
    expect(handleKickSocketEvent("alice", "App\\Events\\ChatMessageEvent", "{}", AT)).toBe("ignored");
    expect(handleKickSocketEvent("alice", "App\\Events\\UserBannedEvent", "{}", AT)).toBe("ignored");
    expect(handleKickSocketEvent("alice", "App\\Events\\MessageDeletedEvent", "not json", AT)).toBe(
      "ignored",
    );
    expect(listModerationEvents({}, db).total).toBe(0);
  });

  test("ignores a channel that is not being logged", () => {
    const data = JSON.stringify({ id: "c-2" });
    handleKickSocketEvent("someone-else", "App\\Events\\ChatroomClearEvent", data, AT);
    expect(listModerationEvents({}, db).total).toBe(0);
  });
});

describe("startKickChatSocket", () => {
  afterEach(() => stopKickChatSocket());

  test("subscribes to each chatroom, answers pings and routes events by room", async () => {
    const sent: string[] = [];
    const fake: KickSocketLike = {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send: (data) => sent.push(data),
      close: () => {},
    };

    await startKickChatSocket({
      createSocket: () => fake,
      listChannels: () => ["alice"],
      resolveChatroom: async () => 42,
    });
    fake.onopen?.({});

    expect(JSON.parse(sent[0] ?? "")).toEqual({
      event: "pusher:subscribe",
      data: { auth: "", channel: "chatrooms.42.v2" },
    });

    fake.onmessage?.({ data: JSON.stringify({ event: "pusher:ping", data: {} }) });
    expect(JSON.parse(sent[1] ?? "")).toEqual({ event: "pusher:pong", data: {} });

    fake.onmessage?.({
      data: JSON.stringify({
        event: "App\\Events\\ChatroomClearEvent",
        channel: "chatrooms.42.v2",
        data: JSON.stringify({ id: "c-3" }),
      }),
    });
    expect(listModerationEvents({}, db).events[0]).toMatchObject({
      platform: "kick",
      broadcaster_login: "alice",
      action: "chat_clear",
    });
  });
});
