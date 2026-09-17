import type { Database } from "bun:sqlite";
import { db as defaultDb } from "../connection";
import { normalizeChatLogin } from "../../chat/targets";
import type { Platform } from "../../types";

// Statistics are computed on read rather than rolled up into a table: the log is
// small enough that a grouped scan over an indexed range is cheaper than keeping
// a second copy of the truth in sync with every insert.
export interface StatsFilter {
  platform?: Platform;
  login?: string;
  // Window size in days, counted back from now. 0 means "everything".
  days?: number;
}

export interface ChatStats {
  totalMessages: number;
  uniqueChatters: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  byDay: { day: string; messages: number }[];
  byHour: number[];
  topChatters: { login: string; display: string | null; messages: number }[];
}

export interface ModerationStats {
  total: number;
  bans: number;
  timeouts: number;
  byDay: { day: string; bans: number; timeouts: number }[];
  topTargets: { login: string; count: number }[];
  topActors: { login: string; count: number }[];
}

export const DEFAULT_STATS_DAYS = 30;

function windowStart(days: number): string | null {
  if (days <= 0) return null;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// Both tables are filtered by the same three things, and the placeholder numbering
// has to match the order the values are bound in.
function windowClause(
  filter: StatsFilter,
  column: string,
): { clause: string; params: (string | number)[] } {
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

  const from = windowStart(filter.days ?? DEFAULT_STATS_DAYS);
  if (from) add(`${column} >= ?`, from);

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export function chatStats(
  filter: StatsFilter = {},
  db: Database = defaultDb,
): ChatStats {
  const { clause, params } = windowClause(filter, "sent_at");

  const totals = db
    .query(
      `SELECT COUNT(*) AS total,
              COUNT(DISTINCT sender_login) AS chatters,
              MIN(sent_at) AS first_at,
              MAX(sent_at) AS last_at
         FROM chat_messages ${clause}`,
    )
    .get(...params) as {
    total: number;
    chatters: number;
    first_at: string | null;
    last_at: string | null;
  };

  const byDay = db
    .query(
      `SELECT substr(sent_at, 1, 10) AS day, COUNT(*) AS messages
         FROM chat_messages ${clause}
        GROUP BY day
        ORDER BY day ASC`,
    )
    .all(...params) as { day: string; messages: number }[];

  const hourRows = db
    .query(
      `SELECT CAST(substr(sent_at, 12, 2) AS INTEGER) AS hour, COUNT(*) AS messages
         FROM chat_messages ${clause}
        GROUP BY hour`,
    )
    .all(...params) as { hour: number; messages: number }[];

  // A fixed 24-length array so the front end can chart it without knowing which
  // hours happened to have traffic.
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const row of hourRows) {
    if (row.hour >= 0 && row.hour < 24) byHour[row.hour] = row.messages;
  }

  const topChatters = db
    .query(
      `SELECT sender_login AS login,
              MAX(sender_display) AS display,
              COUNT(*) AS messages
         FROM chat_messages ${clause ? `${clause} AND` : "WHERE"} sender_login IS NOT NULL
        GROUP BY sender_login
        ORDER BY messages DESC, login ASC
        LIMIT 10`,
    )
    .all(...params) as {
    login: string;
    display: string | null;
    messages: number;
  }[];

  return {
    totalMessages: totals.total,
    uniqueChatters: totals.chatters,
    firstMessageAt: totals.first_at,
    lastMessageAt: totals.last_at,
    byDay,
    byHour,
    topChatters,
  };
}

export function moderationStats(
  filter: StatsFilter = {},
  db: Database = defaultDb,
): ModerationStats {
  const { clause, params } = windowClause(filter, "created_at");

  const totals = db
    .query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN action = 'ban' THEN 1 ELSE 0 END) AS bans,
              SUM(CASE WHEN action = 'timeout' THEN 1 ELSE 0 END) AS timeouts
         FROM moderation_events ${clause}`,
    )
    .get(...params) as {
    total: number;
    bans: number | null;
    timeouts: number | null;
  };

  const byDay = db
    .query(
      `SELECT substr(created_at, 1, 10) AS day,
              SUM(CASE WHEN action = 'ban' THEN 1 ELSE 0 END) AS bans,
              SUM(CASE WHEN action = 'timeout' THEN 1 ELSE 0 END) AS timeouts
         FROM moderation_events ${clause}
        GROUP BY day
        ORDER BY day ASC`,
    )
    .all(...params) as { day: string; bans: number; timeouts: number }[];

  const topTargets = db
    .query(
      `SELECT target_login AS login, COUNT(*) AS count
         FROM moderation_events ${clause ? `${clause} AND` : "WHERE"} target_login IS NOT NULL
        GROUP BY target_login
        ORDER BY count DESC, login ASC
        LIMIT 10`,
    )
    .all(...params) as { login: string; count: number }[];

  const topActors = db
    .query(
      `SELECT actor_login AS login, COUNT(*) AS count
         FROM moderation_events ${clause ? `${clause} AND` : "WHERE"} actor_login IS NOT NULL
        GROUP BY actor_login
        ORDER BY count DESC, login ASC
        LIMIT 10`,
    )
    .all(...params) as { login: string; count: number }[];

  return {
    total: totals.total,
    bans: totals.bans ?? 0,
    timeouts: totals.timeouts ?? 0,
    byDay,
    topTargets,
    topActors,
  };
}
