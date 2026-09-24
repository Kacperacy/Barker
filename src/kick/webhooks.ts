import { createHash, createVerify } from "node:crypto";
import { env } from "../config";
import { logger } from "../utils/logger";
import { saveChatMessage, saveModerationEvent } from "../chat/ingest";
import { classifyBan } from "../chat/moderation";
import {
  kickChatMessageSentEventSchema,
  kickModerationBannedEventSchema,
  kickPublicKeyResponseSchema,
} from "./schemas";

// Kick delivers events by webhook and signs each one, so signature verification
// is the only thing between this endpoint and anyone on the internet posting
// fake bans into the log.
//
// The signature covers "{Kick-Event-Message-Id}.{Kick-Event-Message-Timestamp}.{raw body}"
// (see https://docs.kick.com/events/webhook-security), signed RSA PKCS#1 v1.5
// with SHA-256. The body therefore has to be read verbatim — re-serializing the
// parsed JSON would change the bytes and break every signature.
const PUBLIC_KEY_URL = "https://api.kick.com/public/v1/public-key";
const PUBLIC_KEY_CACHE_MS = 24 * 60 * 60 * 1000;

export interface KickWebhookDeps {
  // Injectable so tests can verify against a key pair they generated.
  getPublicKey?: () => Promise<string | null>;
}

let cachedPublicKey: { pem: string; fetchedAt: number } | null = null;

async function fetchPublicKey(): Promise<string | null> {
  // A pinned key (KICK_WEBHOOK_PUBLIC_KEY) skips the network entirely, which is
  // what a deployment that wants no runtime dependency on Kick's API uses.
  if (env.KICK_WEBHOOK_PUBLIC_KEY) return env.KICK_WEBHOOK_PUBLIC_KEY;

  if (
    cachedPublicKey &&
    Date.now() - cachedPublicKey.fetchedAt < PUBLIC_KEY_CACHE_MS
  ) {
    return cachedPublicKey.pem;
  }

  try {
    const res = await fetch(PUBLIC_KEY_URL);
    if (!res.ok) {
      logger.error(`[Kick] public key fetch failed: ${res.status}`);
      return null;
    }

    const parsed = kickPublicKeyResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      logger.error(
        `[Kick] unexpected public key response: ${parsed.error.message}`,
      );
      return null;
    }

    cachedPublicKey = {
      pem: parsed.data.data.public_key,
      fetchedAt: Date.now(),
    };
    return cachedPublicKey.pem;
  } catch (error) {
    logger.error("[Kick] public key fetch threw:", error);
    return null;
  }
}

// Kick fills an empty reason with this placeholder text; stored as-is it reads
// like a reason someone gave.
const KICK_NO_REASON = "no reason provided";

function kickReason(reason: string | null | undefined): string | null {
  const text = reason?.trim() ?? "";
  return text === "" || text.toLowerCase() === KICK_NO_REASON ? null : text;
}

export function verifyKickSignature(input: {
  messageId: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  publicKey: string;
}): boolean {
  if (!input.messageId || !input.timestamp || !input.signature) return false;

  const signed = `${input.messageId}.${input.timestamp}.${input.body}`;

  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(signed, "utf8");
    verifier.end();
    return verifier.verify(
      input.publicKey,
      Buffer.from(input.signature, "base64"),
    );
  } catch {
    // An unparseable key or signature is a failed verification, not a crash.
    return false;
  }
}

// Falls back to hashing the body when a delivery arrives without its
// Kick-Event-Message-Id: the id is the documented idempotency key, and a
// deterministic hash keeps a redelivery a no-op even without it.
export function kickEventId(
  messageId: string | null,
  body: string,
): string {
  if (messageId) return messageId;
  return createHash("sha256").update(body).digest("hex");
}

function kickBadgeNames(
  badges: { text?: string; type?: string }[] | undefined,
): string[] {
  if (!badges) return [];
  return badges
    .map((badge) => badge.text ?? badge.type ?? "")
    .filter((name) => name !== "");
}

export interface KickWebhookResult {
  status: number;
  body: Record<string, unknown>;
}

function handleChatMessage(
  payload: unknown,
  messageId: string | null,
  body: string,
): KickWebhookResult {
  const parsed = kickChatMessageSentEventSchema.safeParse(payload);
  if (!parsed.success) {
    logger.error(
      `[Kick] unexpected chat.message.sent payload: ${parsed.error.message}`,
    );
    return { status: 400, body: { error: "unexpected chat payload" } };
  }

  const event = parsed.data;
  const queued = saveChatMessage({
    platform: "kick",
    broadcasterLogin: event.broadcaster.channel_slug ?? event.broadcaster.username,
    // The payload's own message id is the log's dedupe key; the delivery id is
    // only a fallback for a payload that somehow lacks it.
    messageId: event.message_id || kickEventId(messageId, body),
    sentAt: event.created_at,
    content: event.content,
    senderUserId: String(event.sender.user_id),
    // channel_slug is the login; username is what chat displays.
    senderLogin: (event.sender.channel_slug ?? event.sender.username).toLowerCase(),
    senderDisplay: event.sender.username,
    senderColor: event.sender.identity?.username_color ?? null,
    badges: kickBadgeNames(event.sender.identity?.badges),
    replyToMessageId: event.replies_to?.message_id ?? null,
  });

  // `queued`, not `stored`: messages are buffered and written on the next flush,
  // so this reports that the delivery was accepted, not that it was new. The
  // insert's ON CONFLICT is what makes a redelivery harmless.
  return { status: 200, body: { ok: true, queued } };
}

function handleModerationBanned(
  payload: unknown,
  messageId: string | null,
  body: string,
): KickWebhookResult {
  const parsed = kickModerationBannedEventSchema.safeParse(payload);
  if (!parsed.success) {
    logger.error(
      `[Kick] unexpected moderation.banned payload: ${parsed.error.message}`,
    );
    return { status: 400, body: { error: "unexpected moderation payload" } };
  }

  const event = parsed.data;
  const expiresAt = event.metadata.expires_at ?? null;
  // A set expires_at is a timeout; null is a permanent ban.
  const details = classifyBan({
    startedAt: event.metadata.created_at,
    expiresAt,
    isPermanent: expiresAt === null,
  });

  const stored = saveModerationEvent({
    platform: "kick",
    eventId: kickEventId(messageId, body),
    broadcasterLogin: event.broadcaster.channel_slug ?? event.broadcaster.username,
    createdAt: event.metadata.created_at,
    action: details.action,
    targetUserId: String(event.banned_user.user_id),
    targetLogin: (
      event.banned_user.channel_slug ?? event.banned_user.username
    ).toLowerCase(),
    targetDisplay: event.banned_user.username,
    actorLogin: event.moderator
      ? (event.moderator.channel_slug ?? event.moderator.username).toLowerCase()
      : null,
    reason: kickReason(event.metadata.reason),
    durationMinutes: details.durationMinutes,
    expiresAt,
  });

  return { status: 200, body: { ok: true, stored, action: details.action } };
}

// The whole path from raw request to stored rows with no HTTP server involved, so
// tests can drive it with a genuine signature over a genuine body.
export async function processKickWebhook(input: {
  headers: Headers;
  body: string;
  deps?: KickWebhookDeps;
}): Promise<KickWebhookResult> {
  const getPublicKey = input.deps?.getPublicKey ?? fetchPublicKey;
  const publicKey = await getPublicKey();
  if (!publicKey) {
    // Refusing beats accepting unverified events: Kick retries for a day, so a
    // missing key is recoverable, whereas a spoofed ban is written for good.
    return { status: 503, body: { error: "signing key unavailable" } };
  }

  const verified = verifyKickSignature({
    messageId: input.headers.get("kick-event-message-id"),
    timestamp: input.headers.get("kick-event-message-timestamp"),
    signature: input.headers.get("kick-event-signature"),
    body: input.body,
    publicKey,
  });

  if (!verified) {
    logger.warn("[Kick] rejected a webhook with an invalid signature");
    return { status: 401, body: { error: "invalid signature" } };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.body);
  } catch {
    return { status: 400, body: { error: "invalid json" } };
  }

  const messageId = input.headers.get("kick-event-message-id");
  const eventType = input.headers.get("kick-event-type") ?? "";

  if (eventType === "chat.message.sent") {
    return handleChatMessage(payload, messageId, input.body);
  }

  if (eventType === "moderation.banned") {
    return handleModerationBanned(payload, messageId, input.body);
  }

  // A subscribed type we do not store is acknowledged rather than failed: a
  // non-2xx counts as a failed delivery, and Kick unsubscribes an endpoint that
  // keeps failing.
  return { status: 200, body: { ok: true, ignored: eventType || "unknown" } };
}

export async function handleKickWebhookRequest(
  request: Request,
  deps: KickWebhookDeps = {},
): Promise<Response> {
  // Read once, verbatim: the signature covers these exact bytes.
  const body = await request.text();
  const result = await processKickWebhook({
    headers: request.headers,
    body,
    deps,
  });

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
