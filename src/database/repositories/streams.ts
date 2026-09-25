import type { Database } from "bun:sqlite";
import { db as defaultDb } from "../connection";
import type { Platform } from "../../types";
import { normalizeChatLogin } from "../../chat/targets";

// Broadcasts of the logged channels and their viewer counts over time. Written by
// streams/polling.ts; the chat log links to a row through `stream_id`.

export interface StreamSample {
  platform: Platform;
  streamId: string;
  broadcasterLogin: string;
  title?: string | null;
  category?: string | null;
  startedAt: string;
  viewers: number;
  at: string;
}

// One poll of a live channel: keeps the row current (title and category change
// mid-stream, the latest wins), raises the peak, and adds a sample.
export function recordStreamSample(sample: StreamSample, db: Database = defaultDb): void {
  const login = normalizeChatLogin(sample.platform, sample.broadcasterLogin);
  db.transaction(() => {
    db.query(
      `INSERT INTO streams
         (platform, stream_id, broadcaster_login, title, category, started_at,
          last_seen_at, ended_at, peak_viewers)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8)
       ON CONFLICT (platform, stream_id) DO UPDATE SET
         title = COALESCE(excluded.title, streams.title),
         category = COALESCE(excluded.category, streams.category),
         last_seen_at = excluded.last_seen_at,
         ended_at = NULL,
         peak_viewers = MAX(COALESCE(streams.peak_viewers, 0), excluded.peak_viewers)`,
    ).run(
      sample.platform,
      sample.streamId,
      login,
      sample.title ?? null,
      sample.category ?? null,
      sample.startedAt,
      sample.at,
      sample.viewers,
    );
    db.query(
      `INSERT OR IGNORE INTO stream_viewer_samples (platform, stream_id, at, viewers)
       VALUES (?1, ?2, ?3, ?4)`,
    ).run(sample.platform, sample.streamId, sample.at, sample.viewers);
  })();
}

// A channel that is no longer live ends its open streams at the last time it was
// seen live — the poll that found it offline is up to one interval late.
export function closeOpenStreams(
  platform: Platform,
  broadcasterLogin: string,
  db: Database = defaultDb,
): number {
  const login = normalizeChatLogin(platform, broadcasterLogin);
  return db
    .query(
      `UPDATE streams SET ended_at = last_seen_at
        WHERE platform = ?1 AND broadcaster_login = ?2 AND ended_at IS NULL`,
    )
    .run(platform, login).changes;
}

export interface StreamRow {
  platform: Platform;
  stream_id: string;
  broadcaster_login: string;
  title: string | null;
  category: string | null;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  peak_viewers: number | null;
  avg_viewers: number | null;
  messages: number;
  chatters: number;
  bans: number;
  timeouts: number;
}

export interface StreamFilter {
  platform?: Platform;
  login?: string;
  limit?: number;
  offset?: number;
}

export const DEFAULT_STREAM_PAGE = 50;
export const MAX_STREAM_PAGE = 200;

export function listStreams(
  filter: StreamFilter = {},
  db: Database = defaultDb,
): { streams: StreamRow[]; total: number; limit: number; offset: number } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (filter.platform) {
    params.push(filter.platform);
    conditions.push(`s.platform = ?${params.length}`);
  }
  if (filter.login) {
    params.push(
      filter.platform
        ? normalizeChatLogin(filter.platform, filter.login)
        : filter.login.trim().toLowerCase(),
    );
    conditions.push(`s.broadcaster_login = ?${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(1, filter.limit ?? DEFAULT_STREAM_PAGE), MAX_STREAM_PAGE);
  const offset = Math.max(0, filter.offset ?? 0);

  // Per-stream totals are read from the logs on the fly: a handful of indexed
  // lookups per row, for pages of at most MAX_STREAM_PAGE rows.
  const streams = db
    .query(
      `SELECT s.*,
         (SELECT CAST(ROUND(AVG(v.viewers)) AS INTEGER) FROM stream_viewer_samples v
           WHERE v.platform = s.platform AND v.stream_id = s.stream_id) AS avg_viewers,
         (SELECT COUNT(*) FROM chat_messages m
           WHERE m.platform = s.platform AND m.stream_id = s.stream_id) AS messages,
         (SELECT COUNT(DISTINCT COALESCE(m.sender_login, m.sender_user_id)) FROM chat_messages m
           WHERE m.platform = s.platform AND m.stream_id = s.stream_id) AS chatters,
         (SELECT COUNT(*) FROM moderation_events e
           WHERE e.platform = s.platform AND e.stream_id = s.stream_id AND e.action = 'ban') AS bans,
         (SELECT COUNT(*) FROM moderation_events e
           WHERE e.platform = s.platform AND e.stream_id = s.stream_id AND e.action = 'timeout') AS timeouts
       FROM streams s ${where}
       ORDER BY s.started_at DESC
       LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`,
    )
    .all(...params, limit, offset) as StreamRow[];

  const total = (
    db.query(`SELECT COUNT(*) AS count FROM streams s ${where}`).get(...params) as {
      count: number;
    }
  ).count;

  return { streams, total, limit, offset };
}

export function listViewerSamples(
  platform: Platform,
  streamId: string,
  db: Database = defaultDb,
): { at: string; viewers: number }[] {
  return db
    .query(
      `SELECT at, viewers FROM stream_viewer_samples
        WHERE platform = ?1 AND stream_id = ?2 ORDER BY at`,
    )
    .all(platform, streamId) as { at: string; viewers: number }[];
}
