import type { Database } from "bun:sqlite";
import { db as defaultDb } from "../connection";
import type { Platform } from "../../types";
import { normalizeChatLogin, type ChatLogTarget } from "../../chat/targets";

// What a moderation row is. Kick only reports the ban side — there is no
// `moderation.unbanned` event — and Twitch has separate clear/delete events, so
// the union is deliberately a plain string in the schema rather than a DB
// CHECK constraint that would reject a new action after a platform update.
export type ModerationAction =
  | "ban"
  | "timeout"
  | "unban"
  | "message_delete"
  | "chat_clear"
  | "chat_clear_user";

export interface ModerationEventRow {
  platform: Platform;
  event_id: string;
  broadcaster_login: string;
  stream_id: string | null;
  action: ModerationAction;
  target_user_id: string | null;
  target_login: string | null;
  target_display: string | null;
  actor_login: string | null;
  reason: string | null;
  duration_minutes: number | null;
  expires_at: string | null;
  created_at: string;
  received_at: string;
}

export interface NewModerationEvent {
  platform: Platform;
  eventId: string;
  broadcasterLogin: string;
  streamId?: string | null;
  action: ModerationAction;
  targetUserId?: string | null;
  targetLogin?: string | null;
  targetDisplay?: string | null;
  actorLogin?: string | null;
  reason?: string | null;
  durationMinutes?: number | null;
  expiresAt?: string | null;
  createdAt: string;
}

export interface ModerationEventFilter {
  platform?: Platform;
  login?: string;
  action?: ModerationAction;
  target?: string;
  from?: string;
  to?: string;
  // (platform, login) pairs to keep out of the result — the hidden channels from
  // chat/ingest.ts.
  excludeChannels?: ChatLogTarget[];
  limit?: number;
  offset?: number;
}

export const DEFAULT_MODERATION_PAGE = 100;
export const MAX_MODERATION_PAGE = 500;

// Returns whether the row was new. Both platforms are at-least-once, and
// moderation actions are the rows where a duplicate is most visible (a timeout
// that appears twice reads as two actions), so this reports it instead of
// hiding it behind an insert count.
export function insertModerationEvent(
  event: NewModerationEvent,
  db: Database = defaultDb,
): boolean {
  const result = db
    .query(
      `INSERT INTO moderation_events
         (platform, event_id, broadcaster_login, stream_id, action, target_user_id,
          target_login, target_display, actor_login, reason, duration_minutes,
          expires_at, created_at, received_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
       ON CONFLICT (platform, event_id) DO NOTHING`,
    )
    .run(
      event.platform,
      event.eventId,
      event.broadcasterLogin,
      event.streamId ?? null,
      event.action,
      event.targetUserId ?? null,
      event.targetLogin ?? null,
      event.targetDisplay ?? null,
      event.actorLogin ?? null,
      event.reason ?? null,
      event.durationMinutes ?? null,
      event.expiresAt ?? null,
      event.createdAt,
      new Date().toISOString(),
    );

  return result.changes > 0;
}

function buildWhere(filter: ModerationEventFilter): {
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
    const login = filter.platform
      ? normalizeChatLogin(filter.platform, filter.login)
      : filter.login.trim().toLowerCase();
    add("broadcaster_login = ?", login);
  }
  if (filter.action) add("action = ?", filter.action);
  if (filter.target) add("target_login = ?", filter.target.trim().toLowerCase());
  if (filter.from) add("created_at >= ?", filter.from);
  if (filter.to) add("created_at <= ?", filter.to);
  for (const hidden of filter.excludeChannels ?? []) {
    const login = normalizeChatLogin(hidden.platform, hidden.login);
    params.push(hidden.platform, login);
    conditions.push(
      `NOT (platform = ?${params.length - 1} AND broadcaster_login = ?${params.length})`,
    );
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export interface ModerationEventPage {
  events: ModerationEventRow[];
  total: number;
  // Echoed back so a caller paging through the list can see the clamp the
  // repository actually applied.
  limit: number;
  offset: number;
}

export function listModerationEvents(
  filter: ModerationEventFilter = {},
  db: Database = defaultDb,
): ModerationEventPage {
  const { clause, params } = buildWhere(filter);
  const limit = Math.min(
    Math.max(1, filter.limit ?? DEFAULT_MODERATION_PAGE),
    MAX_MODERATION_PAGE,
  );
  const offset = Math.max(0, filter.offset ?? 0);

  const events = db
    .query(
      `SELECT * FROM moderation_events ${clause}
       ORDER BY created_at DESC, event_id DESC
       LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`,
    )
    .all(...params, limit, offset) as ModerationEventRow[];

  const total = (
    db
      .query(`SELECT COUNT(*) AS count FROM moderation_events ${clause}`)
      .get(...params) as { count: number }
  ).count;

  return { events, total, limit, offset };
}
