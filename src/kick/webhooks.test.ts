import { beforeEach, describe, expect, test } from "bun:test";
import { createSign, generateKeyPairSync } from "node:crypto";
import { runMigrations } from "../database/migrations/index";
import { db } from "../database/connection";
import { listChatMessages } from "../database/repositories/chatMessages";
import { listModerationEvents } from "../database/repositories/moderationEvents";
import { flushChatMessages, stopChatLogging } from "../chat/ingest";
import { resetLiveBroadcasts, setLiveBroadcast } from "../chat/live";
import {
  kickEventId,
  processKickWebhook,
  verifyKickSignature,
} from "./webhooks";

// A real key pair: the point of these tests is the actual RSA verification, not a
// stubbed boolean. The signature covers
// "{messageId}.{timestamp}.{raw body}" (Kick's documented recipe).
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function sign(
  messageId: string,
  timestamp: string,
  body: string,
  key = privateKey,
): string {
  const signer = createSign("RSA-SHA256");
  signer.update(`${messageId}.${timestamp}.${body}`);
  signer.end();
  return signer.sign(key, "base64");
}

const MESSAGE_ID = "01HZ8X9K2M4N6P8Q0R2S4T6V8W0Y2Z4";
const TIMESTAMP = "2026-01-01T10:05:00Z";

function headersFor(
  type: string,
  body: string,
  options: {
    messageId?: string;
    timestamp?: string;
    signatureOverride?: string;
  } = {},
): Headers {
  const messageId = options.messageId ?? MESSAGE_ID;
  const timestamp = options.timestamp ?? TIMESTAMP;

  return new Headers({
    "kick-event-type": type,
    "kick-event-message-id": messageId,
    "kick-event-message-timestamp": timestamp,
    // Signed over the same id and timestamp that are sent, so a test can only
    // make the signature wrong on purpose.
    "kick-event-signature":
      options.signatureOverride ?? sign(messageId, timestamp, body),
  });
}

const keyDeps = { getPublicKey: async () => publicKeyPem };

function chatPayload(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    message_id: "msg-1",
    content: "hello world",
    created_at: "2026-01-01T10:05:00Z",
    broadcaster: {
      is_anonymous: false,
      user_id: 1,
      username: "Alice",
      channel_slug: "alice",
      is_verified: true,
    },
    sender: {
      is_anonymous: false,
      user_id: 2,
      username: "Bob",
      channel_slug: "bob",
      is_verified: false,
      identity: {
        username_color: "#FF5733",
        badges: [{ text: "Moderator", type: "moderator" }],
      },
    },
    ...over,
  });
}

function banPayload(expiresAt: string | null): string {
  return JSON.stringify({
    broadcaster: {
      is_anonymous: false,
      user_id: 1,
      username: "Alice",
      channel_slug: "alice",
      is_verified: true,
    },
    moderator: {
      is_anonymous: false,
      user_id: 3,
      username: "Mod",
      channel_slug: "mod",
      is_verified: false,
    },
    banned_user: {
      is_anonymous: false,
      user_id: 4,
      username: "Carol",
      channel_slug: "carol",
      is_verified: false,
    },
    metadata: {
      reason: "caps",
      created_at: "2026-01-01T10:00:00Z",
      expires_at: expiresAt,
    },
  });
}

// The suite's default database lives in a temp directory (see test/setup.ts) and
// is migrated per run, so the ingest path can be exercised end to end.
runMigrations();

beforeEach(() => {
  stopChatLogging();
  resetLiveBroadcasts();
  // The suite shares one default database, so each test starts from empty tables
  // and can assert exact counts.
  db.query("DELETE FROM chat_messages").run();
  db.query("DELETE FROM moderation_events").run();
});

describe("verifyKickSignature", () => {
  const body = chatPayload();

  test("accepts a signature over the exact body", () => {
    expect(
      verifyKickSignature({
        messageId: MESSAGE_ID,
        timestamp: TIMESTAMP,
        signature: sign(MESSAGE_ID, TIMESTAMP, body),
        body,
        publicKey: publicKeyPem,
      }),
    ).toBe(true);
  });

  test("rejects a tampered body", () => {
    expect(
      verifyKickSignature({
        messageId: MESSAGE_ID,
        timestamp: TIMESTAMP,
        signature: sign(MESSAGE_ID, TIMESTAMP, body),
        body: `${body} `,
        publicKey: publicKeyPem,
      }),
    ).toBe(false);
  });

  test("rejects a signature from another key", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(
      verifyKickSignature({
        messageId: MESSAGE_ID,
        timestamp: TIMESTAMP,
        signature: sign(MESSAGE_ID, TIMESTAMP, body, other.privateKey),
        body,
        publicKey: publicKeyPem,
      }),
    ).toBe(false);
  });

  test("rejects a request with an incomplete header set", () => {
    for (const missing of [
      { messageId: null },
      { timestamp: null },
      { signature: null },
    ]) {
      expect(
        verifyKickSignature({
          messageId: MESSAGE_ID,
          timestamp: TIMESTAMP,
          signature: sign(MESSAGE_ID, TIMESTAMP, body),
          body,
          publicKey: publicKeyPem,
          ...missing,
        }),
      ).toBe(false);
    }
  });

  test("rejects a key that is not a key instead of throwing", () => {
    expect(
      verifyKickSignature({
        messageId: MESSAGE_ID,
        timestamp: TIMESTAMP,
        signature: sign(MESSAGE_ID, TIMESTAMP, body),
        body,
        publicKey: "not a key",
      }),
    ).toBe(false);
  });
});

describe("processKickWebhook", () => {
  test("stores a chat message with its sender, badges and broadcast", async () => {
    const body = chatPayload();
    setLiveBroadcast("kick", "alice", {
      streamId: "stream-1",
      startedAt: "2026-01-01T10:00:00Z",
    });

    const result = await processKickWebhook({
      headers: headersFor("chat.message.sent", body),
      body,
      deps: keyDeps,
    });
    expect(result).toMatchObject({ status: 200, body: { ok: true, queued: true } });

    flushChatMessages();
    const row = listChatMessages({ platform: "kick", login: "alice" }, db).messages[0];
    expect(row).toMatchObject({
      message_id: "msg-1",
      content: "hello world",
      sender_login: "bob",
      sender_display: "Bob",
      sender_color: "#FF5733",
      badges: '["Moderator"]',
      stream_id: "stream-1",
      offset_seconds: 300,
    });
  });

  test("is idempotent for a redelivered message", async () => {
    const body = chatPayload();
    const headers = headersFor("chat.message.sent", body);

    await processKickWebhook({ headers, body, deps: keyDeps });
    // Accepted again — the buffer cannot know it is a repeat — but the insert is
    // what has to make it harmless.
    const second = await processKickWebhook({ headers, body, deps: keyDeps });
    expect(second).toMatchObject({ status: 200, body: { ok: true, queued: true } });

    flushChatMessages();
    expect(listChatMessages({ platform: "kick", login: "alice" }, db).total).toBe(1);
  });

  test("reads a timeout from expires_at, and a ban from its absence", async () => {
    const timeoutBody = banPayload("2026-01-01T10:10:00Z");
    const timeout = await processKickWebhook({
      // A distinct delivery id per event: the delivery id is what makes a
      // moderation row idempotent, so two events must not share one.
      headers: headersFor("moderation.banned", timeoutBody, { messageId: "evt-timeout" }),
      body: timeoutBody,
      deps: keyDeps,
    });
    expect(timeout.body).toMatchObject({ stored: true, action: "timeout" });

    const banBody = banPayload(null);
    const ban = await processKickWebhook({
      headers: headersFor("moderation.banned", banBody, { messageId: "evt-ban" }),
      body: banBody,
      deps: keyDeps,
    });
    expect(ban.body).toMatchObject({ stored: true, action: "ban" });

    const events = listModerationEvents({ platform: "kick", login: "alice" }, db).events;
    expect(events).toHaveLength(2);
    expect(events.find((row) => row.action === "timeout")).toMatchObject({
      target_login: "carol",
      actor_login: "mod",
      reason: "caps",
      duration_minutes: 10,
      expires_at: "2026-01-01T10:10:00Z",
    });
    expect(events.find((row) => row.action === "ban")).toMatchObject({
      duration_minutes: null,
      expires_at: null,
    });
  });

  test("refuses an unsigned or tampered delivery without storing anything", async () => {
    const body = chatPayload();

    const badSignature = await processKickWebhook({
      headers: headersFor("chat.message.sent", body, {
        signatureOverride: sign(MESSAGE_ID, TIMESTAMP, `${body} `),
      }),
      body,
      deps: keyDeps,
    });
    expect(badSignature.status).toBe(401);

    const noSignature = await processKickWebhook({
      headers: new Headers({ "kick-event-type": "chat.message.sent" }),
      body,
      deps: keyDeps,
    });
    expect(noSignature.status).toBe(401);

    flushChatMessages();
    expect(listChatMessages({ platform: "kick", login: "alice" }, db).total).toBe(0);
  });

  test("fails closed when the signing key is unavailable", async () => {
    const body = chatPayload();
    const result = await processKickWebhook({
      headers: headersFor("chat.message.sent", body),
      body,
      deps: { getPublicKey: async () => null },
    });
    expect(result.status).toBe(503);
  });

  test("acknowledges an event type it does not store", async () => {
    const body = JSON.stringify({ hello: "world" });
    const result = await processKickWebhook({
      headers: headersFor("channel.followed", body),
      body,
      deps: keyDeps,
    });
    expect(result).toMatchObject({
      status: 200,
      body: { ok: true, ignored: "channel.followed" },
    });
  });

  test("rejects a body that is not JSON", async () => {
    const body = "not json";
    const result = await processKickWebhook({
      headers: headersFor("chat.message.sent", body),
      body,
      deps: keyDeps,
    });
    expect(result.status).toBe(400);
  });

  test("rejects a chat payload whose shape changed", async () => {
    const body = chatPayload({ content: undefined });
    const result = await processKickWebhook({
      headers: headersFor("chat.message.sent", body),
      body,
      deps: keyDeps,
    });
    expect(result.status).toBe(400);
  });
});

describe("kickEventId", () => {
  test("uses the delivery id when present", () => {
    expect(kickEventId("evt-1", "{}")).toBe("evt-1");
  });

  test("falls back to a deterministic hash of the body", () => {
    expect(kickEventId(null, '{"a":1}')).toBe(kickEventId(null, '{"a":1}'));
    expect(kickEventId(null, '{"a":1}')).not.toBe(kickEventId(null, '{"a":2}'));
  });
});