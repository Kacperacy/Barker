import { env } from "../config";
import { logger } from "../utils/logger";
import { db as defaultDb } from "../database/connection";
import { deleteChatMessagesBefore } from "../database/repositories/chatMessages";
import type { Database } from "bun:sqlite";

// Optional rolling window on the message log. Moderation rows are never pruned:
// they are small, and they are the part of this feature nobody wants to lose.
export function runChatRetention(db: Database = defaultDb): number {
  if (!env.CHAT_LOG_ENABLED || env.CHAT_LOG_RETENTION_DAYS <= 0) return 0;

  const cutoff = new Date(
    Date.now() - env.CHAT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const removed = deleteChatMessagesBefore(cutoff, db);
  if (removed > 0) {
    logger.info(
      `[Chat] retention removed ${removed} message(s) older than ${cutoff}`,
    );
  }
  return removed;
}

const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function startChatRetention(): void {
  if (!env.CHAT_LOG_ENABLED || env.CHAT_LOG_RETENTION_DAYS <= 0) return;

  runChatRetention();
  const timer = setInterval(() => runChatRetention(), RETENTION_INTERVAL_MS);
  timer.unref?.();
}
