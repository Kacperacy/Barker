import { beforeEach, describe, expect, test } from "bun:test";
import { runMigrations } from "../database/migrations/index";
import { db } from "../database/connection";
import { listChatMessages } from "../database/repositories/chatMessages";
import { listModerationEvents } from "../database/repositories/moderationEvents";
import { flushChatMessages, stopChatLogging } from "../chat/ingest";
import {
  handleIrcLine,
  parseIrcLine,
  startTwitchChatIrc,
  stopTwitchChatIrc,
} from "./chatIrc";
import type { IrcSocketLike } from "./chatIrc";

// Real lines, tags and all: this interface is the whole of what an outside
// observer gets to read a channel with, so the parsing *is* the feature.
const SENT_AT = "1758033900000"; // 2026-09-16T19:25:00Z

function privmsg(over: Record<string, string> = {}): string {
  const tags = {
    "badge-info": "subscriber/12",
    badges: "moderator/1,subscriber/12",
    color: "#FF5733",
    "display-name": "Bob",
    id: "1b2d4f6a-0000-4000-8000-000000000001",
    login: "bob",
    "reply-parent-msg-id": "parent-1",
    "tmi-sent-ts": SENT_AT,
    "user-id": "42",
    ...over,
  };

  const tagString = Object.entries(tags)
    .map(([key, value]) => `${key}=${value}`)
    .join(";");

  return `@${tagString} :bob!bob@bob.tmi.twitch.tv PRIVMSG #alice :siema`;
}

runMigrations();

beforeEach(() => {
  stopChatLogging();
  db.query("DELETE FROM chat_messages").run();
  db.query("DELETE FROM moderation_events").run();
});

describe("parseIrcLine", () => {
  test("splits tags, command, params and the trailing body", () => {
    const parsed = parseIrcLine(privmsg());
    expect(parsed).toMatchObject({
      command: "PRIVMSG",
      params: ["#alice"],
      trailing: "siema",
    });
    expect(parsed?.tags["display-name"]).toBe("Bob");
    expect(parsed?.tags["badges"]).toBe("moderator/1,subscriber/12");
  });

  test("decodes the escaped characters in a tag value", () => {
    const line = `@display-name=Bob\\sSmith;color=#00FF00 :x!x@x PRIVMSG #c :hi`;
    expect(parseIrcLine(line)?.tags["display-name"]).toBe("Bob Smith");
  });

  test("reads a command with no tags and no trailing", () => {
    expect(
      parseIrcLine(":tmi.twitch.tv 001 justinfan12345 :Welcome, GLHF!"),
    ).toMatchObject({ command: "001" });
  });

  test("returns null for a line it cannot make sense of", () => {
    expect(parseIrcLine("")).toBeNull();
    expect(parseIrcLine("@")).toBeNull();
  });
});

describe("handleIrcLine", () => {
  test("stores a message with its author, badges, colour and send time", () => {
    expect(handleIrcLine(privmsg()).outcome).toBe("message");
    flushChatMessages();

    const row = listChatMessages(
      { platform: "twitch", login: "alice" },
      db,
    ).messages[0];

    expect(row).toMatchObject({
      message_id: "1b2d4f6a-0000-4000-8000-000000000001",
      content: "siema",
      sender_login: "bob",
      sender_display: "Bob",
      sender_color: "#FF5733",
      sender_user_id: "42",
      badges: '["moderator","subscriber"]',
      reply_to_message_id: "parent-1",
      // Twitch's own timestamp, not the delivery time.
      sent_at: new Date(Number(SENT_AT)).toISOString(),
    });
  });

  test("answers a server PING", () => {
    expect(handleIrcLine("PING :tmi.twitch.tv")).toEqual({
      outcome: "pong",
      reply: "PONG :tmi.twitch.tv",
    });
  });

  test("reads a permanent ban", () => {
    const line = `@room-id=1;target-user-id=99;tmi-sent-ts=${SENT_AT} :tmi.twitch.tv CLEARCHAT #alice :troll`;
    expect(handleIrcLine(line).outcome).toBe("ban");

    const event = listModerationEvents(
      { platform: "twitch", login: "alice" },
      db,
    ).events[0];

    expect(event).toMatchObject({
      action: "ban",
      target_login: "troll",
      target_user_id: "99",
      duration_minutes: null,
      expires_at: null,
      // CLEARCHAT names no moderator and no reason, and an outside observer
      // cannot know either: they stay null rather than being invented.
      actor_login: null,
      reason: null,
    });
  });

  test("reads a timeout as its length in minutes", () => {
    // ban-duration is in seconds over IRC.
    const line = `@ban-duration=600;target-user-id=99;tmi-sent-ts=${SENT_AT} :tmi.twitch.tv CLEARCHAT #alice :troll`;
    expect(handleIrcLine(line).outcome).toBe("timeout");

    expect(listModerationEvents({}, db).events[0]).toMatchObject({
      action: "timeout",
      duration_minutes: 10,
      expires_at: new Date(Number(SENT_AT) + 600_000).toISOString(),
    });
  });

  test("reads a cleared room as its own action", () => {
    const line = `@room-id=1;tmi-sent-ts=${SENT_AT} :tmi.twitch.tv CLEARCHAT #alice`;
    expect(handleIrcLine(line).outcome).toBe("chat_clear");
    expect(listModerationEvents({}, db).events[0]).toMatchObject({
      action: "chat_clear",
      target_login: null,
    });
  });

  test("reads a single deleted message", () => {
    const line = `@login=troll;target-msg-id=abc-123;tmi-sent-ts=${SENT_AT} :tmi.twitch.tv CLEARMSG #alice :bad words`;
    expect(handleIrcLine(line).outcome).toBe("message_delete");

    expect(listModerationEvents({}, db).events[0]).toMatchObject({
      action: "message_delete",
      target_login: "troll",
      event_id: "delete:abc-123",
    });
  });

  test("ignores everything else the server sends", () => {
    for (const line of [
      ":justinfan12345!justinfan12345@justinfan12345.tmi.twitch.tv JOIN #alice",
      ":tmi.twitch.tv 001 justinfan12345 :Welcome, GLHF!",
      "@room-id=1 :tmi.twitch.tv ROOMSTATE #alice",
      "@emote-only=0 :tmi.twitch.tv USERSTATE #alice",
    ]) {
      expect(handleIrcLine(line).outcome).toBe("ignored");
    }

    expect(listChatMessages({}, db).total).toBe(0);
    expect(listModerationEvents({}, db).total).toBe(0);
  });

  test("stores a message without an id exactly once", () => {
    // A line with no id tag still has to be storable, and a reconnect replaying
    // it must not double up.
    const line = `@login=bob;display-name=Bob;tmi-sent-ts=${SENT_AT} :bob!bob@bob.tmi.twitch.tv PRIVMSG #alice :no id`;

    handleIrcLine(line);
    handleIrcLine(line);
    flushChatMessages();

    expect(listChatMessages({}, db).total).toBe(1);
  });
});

describe("anonymous connection", () => {
  class FakeSocket implements IrcSocketLike {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;
    onclose: (() => void) | null = null;
    sent: string[] = [];
    closed = false;

    send(data: string) {
      this.sent.push(data);
    }

    close() {
      this.closed = true;
      this.onclose?.();
    }

    emit(data: string) {
      this.onmessage?.({ data });
    }
  }

  test("hands in without an account and joins the configured channels", () => {
    const sockets: FakeSocket[] = [];
    const channels = startTwitchChatIrc({
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      listChannels: () => ["alice"],
      nick: "justinfan4242",
    });

    expect(channels).toEqual(["alice"]);

    const socket = sockets[0]!;
    socket.onopen?.();

    // No token anywhere: an anonymous nick, a throwaway password, capabilities
    // for tags and commands, then the join.
    expect(socket.sent).toEqual([
      "PASS SCHMOOPIIE",
      "NICK justinfan4242",
      "CAP REQ :twitch.tv/tags twitch.tv/commands",
      "JOIN #alice",
    ]);

    // One frame can carry several lines, and a PING has to be answered or Twitch
    // drops the connection.
    socket.emit(`PING :tmi.twitch.tv\r\n${privmsg()}\r\n`);
    expect(socket.sent).toContain("PONG :tmi.twitch.tv");

    flushChatMessages();
    expect(listChatMessages({ platform: "twitch", login: "alice" }, db).total).toBe(1);

    stopTwitchChatIrc();
    expect(socket.closed).toBe(true);
  });

  test("does not connect at all when no Twitch channel is configured", () => {
    const sockets: FakeSocket[] = [];
    expect(
      startTwitchChatIrc({
        createSocket: () => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket;
        },
        listChannels: () => [],
      }),
    ).toEqual([]);
    expect(sockets).toHaveLength(0);
  });
});