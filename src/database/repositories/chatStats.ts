import type { Database } from "bun:sqlite";
import { db as defaultDb } from "../connection";
import { normalizeChatLogin, type ChatLogTarget } from "../../chat/targets";
import type { Platform } from "../../types";

// Statistics are computed on read rather than rolled up into a table: the log is
// small enough that a grouped scan over an indexed range is cheaper than keeping
// a second copy of the truth in sync with every insert.
export interface StatsFilter {
  platform?: Platform;
  login?: string;
  // Window size in days, counted back from now. 0 means "everything". Ignored
  // when `from` is given, so an absolute range means what it says.
  days?: number;
  // Absolute window; either end optional, both inclusive.
  from?: string;
  to?: string;
  // One broadcast, as recorded on the rows (see chat/live.ts).
  streamId?: string;
  // (platform, login) pairs to keep out of the totals — the hidden channels from
  // chat/ingest.ts, so a dev channel never inflates what the site charts.
  excludeChannels?: ChatLogTarget[];
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
  if (filter.streamId) add("stream_id = ?", filter.streamId);

  const from = filter.from ?? windowStart(filter.days ?? DEFAULT_STATS_DAYS);
  if (from) add(`${column} >= ?`, from);
  if (filter.to) add(`${column} <= ?`, filter.to);
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

// ---------------------------------------------------------------------- series
// The summaries above answer the subpage's question — "what happened in this
// window, by day and by hour". These answer arbitrary ones: the same rows
// grouped by whatever a caller needs, so a chart, an export or a per-broadcast
// view needs no new endpoint. Grouping and metric are picked out of the maps
// below rather than interpolated from the query string, so a request can only
// ever name an expression that already exists in this file.

export type ChatGroupBy =
  | "day"
  | "hour"
  | "weekday"
  | "author"
  | "channel"
  | "platform"
  | "stream";

export type ChatMetric = "messages" | "chatters";

export type ModerationGroupBy =
  | "day"
  | "hour"
  | "weekday"
  | "target"
  | "actor"
  | "action"
  | "channel"
  | "platform"
  | "stream";

export type ModerationMetric = "events" | "bans" | "timeouts" | "targets";

export type SeriesOrder = "key" | "value";

const CHAT_GROUPINGS: Record<ChatGroupBy, string> = {
  // Temporal keys are SQLite's own: the day is the UTC date the timestamp starts
  // with, the hour its hour, the weekday `%w` (0 = Sunday).
  day: "substr(sent_at, 1, 10)",
  hour: "CAST(substr(sent_at, 12, 2) AS INTEGER)",
  weekday: "CAST(strftime('%w', sent_at) AS INTEGER)",
  // An empty key is how a row with nothing to group by comes back: an unknown
  // author, or a message sent while no broadcast was being tracked.
  author: "COALESCE(sender_login, '')",
  channel: "broadcaster_login",
  platform: "platform",
  stream: "COALESCE(stream_id, '')",
};

const CHAT_METRICS: Record<ChatMetric, string> = {
  messages: "COUNT(*)",
  chatters: "COUNT(DISTINCT sender_login)",
};

const MODERATION_GROUPINGS: Record<ModerationGroupBy, string> = {
  day: "substr(created_at, 1, 10)",
  hour: "CAST(substr(created_at, 12, 2) AS INTEGER)",
  weekday: "CAST(strftime('%w', created_at) AS INTEGER)",
  target: "COALESCE(target_login, '')",
  actor: "COALESCE(actor_login, '')",
  action: "action",
  channel: "broadcaster_login",
  platform: "platform",
  stream: "COALESCE(stream_id, '')",
};

const MODERATION_METRICS: Record<ModerationMetric, string> = {
  events: "COUNT(*)",
  bans: "SUM(CASE WHEN action = 'ban' THEN 1 ELSE 0 END)",
  timeouts: "SUM(CASE WHEN action = 'timeout' THEN 1 ELSE 0 END)",
  targets: "COUNT(DISTINCT target_login)",
};

// The accepted values, for the API's validation and its OpenAPI document. Even
// the numeric groupings answer with these, so validation can be a plain
// membership test on an array rather than a check against a prototype-polluted
// object.
export const CHAT_GROUP_BY_VALUES = Object.keys(CHAT_GROUPINGS) as ChatGroupBy[];
export const CHAT_METRIC_VALUES = Object.keys(CHAT_METRICS) as ChatMetric[];
export const MODERATION_GROUP_BY_VALUES = Object.keys(
  MODERATION_GROUPINGS,
) as ModerationGroupBy[];
export const MODERATION_METRIC_VALUES = Object.keys(
  MODERATION_METRICS,
) as ModerationMetric[];
export const SERIES_ORDER_VALUES: SeriesOrder[] = ["key", "value"];

export const DEFAULT_SERIES_LIMIT = 1000;
// A grouping like `author` on a busy channel is unbounded by nature; the cap is
// what keeps one request from serialising the whole log.
export const MAX_SERIES_LIMIT = 5000;

export interface SeriesRow {
  // Every grouping answers with a string key, including the numeric ones (hour,
  // weekday), so a client never has to handle two shapes for one field.
  key: string;
  value: number;
  firstAt: string | null;
  lastAt: string | null;
}

export interface SeriesOptions<G extends string, M extends string> {
  groupBy: G;
  metric: M;
  // `value` ranks (busiest days, top chatters); `key` reads chronologically.
  order?: SeriesOrder;
  limit?: number;
}

interface SeriesQuery {
  table: string;
  timeColumn: string;
  grouping: string;
  metric: string;
}

function runSeries(
  filter: StatsFilter,
  query: SeriesQuery,
  options: { order: SeriesOrder; limit: number },
  db: Database,
): SeriesRow[] {
  const { clause, params } = windowClause(filter, query.timeColumn);

  const rows = db
    .query(
      `SELECT ${query.grouping} AS key,
              ${query.metric} AS value,
              MIN(${query.timeColumn}) AS first_at,
              MAX(${query.timeColumn}) AS last_at
         FROM ${query.table} ${clause}
        GROUP BY key
        ORDER BY ${options.order === "key" ? "key ASC" : "value DESC, key ASC"}
        LIMIT ?${params.length + 1}`,
    )
    .all(...params, options.limit) as {
    key: string | number;
    value: number | null;
    first_at: string | null;
    last_at: string | null;
  }[];

  return rows.map((row) => ({
    key: String(row.key),
    // A SUM over no matching rows is null rather than 0.
    value: row.value ?? 0,
    firstAt: row.first_at,
    lastAt: row.last_at,
  }));
}

export function seriesLimit(limit: number | undefined): number {
  return Math.min(Math.max(1, limit ?? DEFAULT_SERIES_LIMIT), MAX_SERIES_LIMIT);
}

// Chat grouped however the caller asked. `groupBy=channel` is the "what is
// actually in this log" view and `groupBy=stream` the broadcasts with their
// message counts and time bounds — the two things a client wants before it can
// ask anything else.
export function chatSeries(
  filter: StatsFilter,
  options: SeriesOptions<ChatGroupBy, ChatMetric>,
  db: Database = defaultDb,
): SeriesRow[] {
  return runSeries(
    filter,
    {
      table: "chat_messages",
      timeColumn: "sent_at",
      grouping: CHAT_GROUPINGS[options.groupBy],
      metric: CHAT_METRICS[options.metric],
    },
    { order: options.order ?? "value", limit: seriesLimit(options.limit) },
    db,
  );
}

export function moderationSeries(
  filter: StatsFilter,
  options: SeriesOptions<ModerationGroupBy, ModerationMetric>,
  db: Database = defaultDb,
): SeriesRow[] {
  return runSeries(
    filter,
    {
      table: "moderation_events",
      timeColumn: "created_at",
      grouping: MODERATION_GROUPINGS[options.groupBy],
      metric: MODERATION_METRICS[options.metric],
    },
    { order: options.order ?? "value", limit: seriesLimit(options.limit) },
    db,
  );
}
