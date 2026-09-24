import { env } from "../config";
import { logger } from "../utils/logger";
import type { Platform } from "../types";
import { getLiveBroadcast, offsetSeconds } from "./live";
import {
  isChatLogTarget,
  normalizeChatLogin,
  parseChatTargets,
  type ChatLogTarget,
} from "./targets";
import {
  insertChatMessages,
  type NewChatMessage,
} from "../database/repositories/chatMessages";
import {
  insertModerationEvent,
  type ModerationAction,
} from "../database/repositories/moderationEvents";

// Parsed once at load, like archive/jobs.ts: a malformed CHAT_LOG_CHANNELS has to
// stop the bot at startup, because the failure mode is a log with holes in it and
// the messages are gone by the time anyone notices.
let targets: ChatLogTarget[] = [];
if (env.CHAT_LOG_ENABLED) {
  targets = parseChatTargets(env.CHAT_LOG_CHANNELS);
  logger.info(
    `[Chat] Logging chat for ${targets.length} channel(s): ${targets
      .map((target) => `${target.platform}:${target.login}`)
      .join(", ")}`,
  );
}

export function isChatLoggingEnabled(): boolean {
  return env.CHAT_LOG_ENABLED;
}

export function isChatLogTargetFor(platform: Platform, login: string): boolean {
  return env.CHAT_LOG_ENABLED && isChatLogTarget(targets, platform, login);
}

// Everything configured: what the collectors subscribe to and join. The read API
// is general — which channels a site shows is the site's choice, not the bot's.
export function chatLogTargets(): ChatLogTarget[] {
  return targets;
}

export interface IncomingChatMessage {
  platform: Platform;
  broadcasterLogin: string;
  messageId: string;
  sentAt: string;
  content: string;
  senderUserId?: string | null;
  senderLogin?: string | null;
  senderDisplay?: string | null;
  senderColor?: string | null;
  badges?: string[] | null;
  replyToMessageId?: string | null;
}

export interface IncomingModerationEvent {
  platform: Platform;
  eventId: string;
  broadcasterLogin: string;
  createdAt: string;
  action: ModerationAction;
  targetUserId?: string | null;
  targetLogin?: string | null;
  targetDisplay?: string | null;
  actorLogin?: string | null;
  reason?: string | null;
  durationMinutes?: number | null;
  expiresAt?: string | null;
}

// Chat is written through a small buffer rather than one transaction per message:
// a burst in a busy chat would otherwise cost one fsync per line. The flush timer
// is unref'd so it can never hold a short-lived process open.
const FLUSH_INTERVAL_MS = 1000;
// A sudden flood must not grow the buffer without bound; past this it is written
// straight away.
const MAX_BUFFERED = 500;

let buffer: NewChatMessage[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushChatMessages();
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
}

export function flushChatMessages(): number {
  if (buffer.length === 0) return 0;

  const rows = buffer;
  buffer = [];

  try {
    return insertChatMessages(rows);
  } catch (error) {
    // Losing the batch is bad; taking the bot down with it is worse, and the
    // platform will not resend a message it already delivered.
    logger.error(`[Chat] Could not store ${rows.length} message(s):`, error);
    return 0;
  }
}

// Stamps the message with the broadcast it was sent during (see chat/live.ts) and
// queues it. Returns false when the channel is not a logging target.
export function saveChatMessage(message: IncomingChatMessage): boolean {
  if (!isChatLogTargetFor(message.platform, message.broadcasterLogin)) {
    return false;
  }

  const broadcasterLogin = normalizeChatLogin(
    message.platform,
    message.broadcasterLogin,
  );
  const live = getLiveBroadcast(message.platform, broadcasterLogin);

  buffer.push({
    platform: message.platform,
    messageId: message.messageId,
    broadcasterLogin,
    streamId: live?.streamId ?? null,
    streamStartedAt: live?.startedAt ?? null,
    offsetSeconds: live ? offsetSeconds(live.startedAt, message.sentAt) : null,
    sentAt: message.sentAt,
    senderUserId: message.senderUserId ?? null,
    senderLogin: message.senderLogin ?? null,
    senderDisplay: message.senderDisplay ?? null,
    senderColor: message.senderColor ?? null,
    badges: message.badges ?? null,
    content: message.content,
    replyToMessageId: message.replyToMessageId ?? null,
  });

  if (buffer.length >= MAX_BUFFERED) flushChatMessages();
  else ensureFlushTimer();

  return true;
}

// Moderation rows are written immediately: they are rare, and a ban that arrives
// out of order with the messages around it is worse than one extra write. Returns
// whether the row was new (false = the platform redelivered it).
export function saveModerationEvent(event: IncomingModerationEvent): boolean {
  if (!isChatLogTargetFor(event.platform, event.broadcasterLogin)) return false;

  const broadcasterLogin = normalizeChatLogin(
    event.platform,
    event.broadcasterLogin,
  );
  const live = getLiveBroadcast(event.platform, broadcasterLogin);

  try {
    return insertModerationEvent({
      platform: event.platform,
      eventId: event.eventId,
      broadcasterLogin,
      streamId: live?.streamId ?? null,
      action: event.action,
      targetUserId: event.targetUserId ?? null,
      targetLogin: event.targetLogin ?? null,
      targetDisplay: event.targetDisplay ?? null,
      actorLogin: event.actorLogin ?? null,
      reason: event.reason ?? null,
      durationMinutes: event.durationMinutes ?? null,
      expiresAt: event.expiresAt ?? null,
      createdAt: event.createdAt,
    });
  } catch (error) {
    logger.error(`[Chat] Could not store a ${event.action} event:`, error);
    return false;
  }
}

// Called from the shutdown path so a redeploy does not drop the last second of
// chat, and from tests to make assertions deterministic.
export function stopChatLogging(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flushChatMessages();
}
