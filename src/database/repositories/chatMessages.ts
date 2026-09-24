import type { Database } from "bun:sqlite";
import { db as defaultDb } from "../connection";
import type { Platform } from "../../types";
import { normalizeChatLogin } from "../../chat/targets";

export interface ChatMessageRow {
  platform: Platform;
  message_id: string;
  broadcaster_login: string;
  stream_id: string | null;
  stream_started_at: string | null;
  offset_seconds: number | null;
  sent_at: string;
  sender_user_id: string | null;
  sender_login: string | null;
  sender_display: string | null;
  sender_color: string | null;
  badges: string | null;
  content: string;
  reply_to_message_id: string | null;
  received_at: string;
}

export interface NewChatMessage {
  platform: Platform;
  messageId: string;
  broadcasterLogin: string;
  streamId?: string | null;
  streamStartedAt?: string | null;
  offsetSeconds?: number | null;
  sentAt: string;
  senderUserId?: string | null;
  senderLogin?: string | null;
  senderDisplay?: string | null;
  senderColor?: string | null;
  badges?: string[] | null;
  content: string;
  replyToMessageId?: string | null;
}

export interface ChatMessageFilter {
  platform?: Platform;
  login?: string;
  author?: string;
  q?: string;
  from?: string;
  to?: string;
  streamId?: string;
  limit?: number;
  offset?: number;
}

export const DEFAULT_CHAT_PAGE = 100;
// The subpage pages through the log, so one request may never ask for the whole
// table — the log grows without bound and the read API is public.
export const MAX_CHAT_PAGE = 500;

function now(): string {
  return new Date().toISOString();
}

// Batched inside one transaction: a busy chat delivers messages faster than one
// statement per fsync would be worth. `ON CONFLICT DO NOTHING` is what makes an
// at-least-once delivery (Kick redelivering a webhook, Twitch redelivering a
// notification) a no-op instead of a duplicate row.
export function insertChatMessages(
  messages: NewChatMessage[],
  db: Database = defaultDb,
): number {
  if (messages.length === 0) return 0;

  const insert = db.query(
    `INSERT INTO chat_messages
       (platform, message_id, broadcaster_login, stream_id, stream_started_at,
        offset_seconds, sent_at, sender_user_id, sender_login, sender_display,
        sender_color, badges, content, reply_to_message_id, received_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
     ON CONFLICT (platform, message_id) DO NOTHING`,
  );

  const receivedAt = now();
  let inserted = 0;

  const run = db.transaction((rows: NewChatMessage[]) => {
    for (const message of rows) {
      const result = insert.run(
        message.platform,
        message.messageId,
        message.broadcasterLogin,
        message.streamId ?? null,
        message.streamStartedAt ?? null,
        message.offsetSeconds ?? null,
        message.sentAt,
        message.senderUserId ?? null,
        message.senderLogin ?? null,
        message.senderDisplay ?? null,
        message.senderColor ?? null,
        message.badges ? JSON.stringify(message.badges) : null,
        message.content,
        message.replyToMessageId ?? null,
        receivedAt,
      );
      inserted += result.changes;
    }
  });

  run(messages);
  return inserted;
}


// LIKE is the search here rather than FTS5: the log is read newest-first over a
// narrow time window, and a substring match inside an indexed range is fast
// enough at this size. `%` and `_` in the query are escaped so they search for
// themselves instead of acting as wildcards.
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

// A person is looked up the way a reader names them: by login or by the display
// name chat shows, case-insensitively. Kick's login is the channel slug, which
// spells underscores as hyphens ("Some_User" → "some-user"), so both spellings
// of the login are tried.
function personMatch(
  loginColumn: string,
  displayColumn: string,
  value: string,
  params: (string | number)[],
): string {
  const name = value.trim().toLowerCase();
  params.push(name, name.replace(/_/g, "-"));
  const a = params.length - 1;
  const b = params.length;
  return `(${loginColumn} IN (?${a}, ?${b}) OR lower(${displayColumn}) = ?${a})`;
}

function buildWhere(filter: ChatMessageFilter): {
  clause: string;
  params: (string | number)[];
} {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  const add = (condition: string, value: string | number) => {
    params.push(value);
    conditions.push(condition.replace("?", `?${params.length}`));
  };

  if (filter.platform) add("platform = ?", filter.platform);
  if (filter.login) {
    // Stored logins are normalized on the way in (see chat/targets.ts), so the
    // filter has to be normalized the same way or Kick's hyphenated slug would
    // never match what a user types.
    const login = filter.platform
      ? normalizeChatLogin(filter.platform, filter.login)
      : filter.login.trim().toLowerCase();
    add("broadcaster_login = ?", login);
  }
  if (filter.author) {
    conditions.push(personMatch("sender_login", "sender_display", filter.author, params));
  }
  if (filter.streamId) add("stream_id = ?", filter.streamId);
  if (filter.from) add("sent_at >= ?", filter.from);
  if (filter.to) add("sent_at <= ?", filter.to);
  if (filter.q) add("content LIKE ? ESCAPE '\\'", likePattern(filter.q));

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export interface ChatMessagePage {
  messages: ChatMessageRow[];
  total: number;
  // Echoed back so a caller paging through the log can see the clamp the
  // repository actually applied.
  limit: number;
  offset: number;
}

export function listChatMessages(
  filter: ChatMessageFilter = {},
  db: Database = defaultDb,
): ChatMessagePage {
  const { clause, params } = buildWhere(filter);
  const limit = Math.min(
    Math.max(1, filter.limit ?? DEFAULT_CHAT_PAGE),
    MAX_CHAT_PAGE,
  );
  const offset = Math.max(0, filter.offset ?? 0);

  // Newest first, with the message id as the tie-breaker: two messages can share
  // a timestamp, and without it paging could repeat or skip a row.
  const messages = db
    .query(
      `SELECT * FROM chat_messages ${clause}
       ORDER BY sent_at DESC, message_id DESC
       LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`,
    )
    .all(...params, limit, offset) as ChatMessageRow[];

  const total = (
    db
      .query(`SELECT COUNT(*) AS count FROM chat_messages ${clause}`)
      .get(...params) as { count: number }
  ).count;

  return { messages, total, limit, offset };
}

// Retention. Chat is the one table that grows with every viewer message, so a
// log kept whole is fine for this channel and not for a busy one;
// CHAT_LOG_RETENTION_DAYS > 0 prunes it. Moderation events are deliberately out
// of scope: they are small and are the part nobody wants to lose.
export function deleteChatMessagesBefore(
  iso: string,
  db: Database = defaultDb,
): number {
  return db.query("DELETE FROM chat_messages WHERE sent_at < ?1").run(iso)
    .changes;
}
