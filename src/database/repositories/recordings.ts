import type { Database } from "bun:sqlite";
import { db as defaultDb } from "../connection";
import type { Platform } from "../../types";

export interface RecordingRow {
  platform: Platform;
  video_id: string;
  channel_login: string;
  stream_id: string | null;
  title: string | null;
  category: string | null;
  started_at: string;
  duration_seconds: number;
  source_url: string | null;
  thumbnail_url: string | null;
  views: number | null;
  first_seen_at: string;
  last_seen_at: string;
  gone_at: string | null;
}

export interface NewRecording {
  platform: Platform;
  videoId: string;
  channelLogin: string;
  streamId?: string | null;
  title?: string | null;
  category?: string | null;
  startedAt: string;
  durationSeconds: number;
  sourceUrl?: string | null;
  thumbnailUrl?: string | null;
  views?: number | null;
}

// One platform's full list for a channel, as just read: upserts every entry and
// marks the ones it no longer lists as gone (deleted or expired there). Only
// call it with a list that was read successfully — an empty list from a failed
// read would mark everything gone.
export function syncRecordings(
  platform: Platform,
  channelLogin: string,
  list: NewRecording[],
  db: Database = defaultDb,
  now: string = new Date().toISOString(),
): { upserted: number; gone: number } {
  const login = channelLogin.toLowerCase();
  let gone = 0;
  db.transaction(() => {
    const upsert = db.query(
      `INSERT INTO recordings
         (platform, video_id, channel_login, stream_id, title, category, started_at,
          duration_seconds, source_url, thumbnail_url, views, first_seen_at, last_seen_at, gone_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, NULL)
       ON CONFLICT (platform, video_id) DO UPDATE SET
         stream_id = COALESCE(excluded.stream_id, recordings.stream_id),
         title = excluded.title,
         category = COALESCE(excluded.category, recordings.category),
         started_at = excluded.started_at,
         duration_seconds = excluded.duration_seconds,
         source_url = excluded.source_url,
         thumbnail_url = excluded.thumbnail_url,
         views = excluded.views,
         last_seen_at = excluded.last_seen_at,
         gone_at = NULL`,
    );
    for (const entry of list) {
      upsert.run(
        platform,
        entry.videoId,
        login,
        entry.streamId ?? null,
        entry.title ?? null,
        entry.category ?? null,
        entry.startedAt,
        Math.max(0, Math.round(entry.durationSeconds)),
        entry.sourceUrl ?? null,
        entry.thumbnailUrl ?? null,
        entry.views ?? null,
        now,
      );
    }
    gone = db
      .query(
        `UPDATE recordings SET gone_at = ?3
          WHERE platform = ?1 AND channel_login = ?2 AND gone_at IS NULL AND last_seen_at < ?3`,
      )
      .run(platform, login, now).changes;
  })();
  return { upserted: list.length, gone };
}

export interface ChannelRef {
  platform: Platform;
  login: string;
}

function channelCondition(channels: ChannelRef[], params: (string | number)[]): string {
  if (channels.length === 0) return "1 = 1";
  const parts = channels.map((channel) => {
    params.push(channel.platform, channel.login.toLowerCase());
    return `(platform = ?${params.length - 1} AND channel_login = ?${params.length})`;
  });
  return `(${parts.join(" OR ")})`;
}

// Recordings covering an instant (unix seconds), with a little slack either
// side: platforms start recording a moment after go-live.
export function recordingsAt(
  channels: ChannelRef[],
  unixSeconds: number,
  db: Database = defaultDb,
  slackSeconds = 60,
): RecordingRow[] {
  const params: (string | number)[] = [];
  const where = channelCondition(channels, params);
  params.push(unixSeconds, slackSeconds);
  const t = `?${params.length - 1}`;
  const slack = `?${params.length}`;
  return db
    .query(
      `SELECT * FROM recordings
        WHERE ${where}
          AND CAST(strftime('%s', started_at) AS INTEGER) - ${slack} <= ${t}
          AND CAST(strftime('%s', started_at) AS INTEGER) + duration_seconds + ${slack} >= ${t}
        ORDER BY gone_at IS NOT NULL, started_at DESC`,
    )
    .all(...params) as RecordingRow[];
}

export function listRecordings(
  channels: ChannelRef[],
  options: { limit?: number; offset?: number; includeGone?: boolean } = {},
  db: Database = defaultDb,
): { recordings: RecordingRow[]; total: number } {
  const params: (string | number)[] = [];
  const where = `${channelCondition(channels, params)}${options.includeGone ? "" : " AND gone_at IS NULL"}`;
  const limit = Math.min(Math.max(1, options.limit ?? 100), 500);
  const offset = Math.max(0, options.offset ?? 0);
  const recordings = db
    .query(
      `SELECT * FROM recordings WHERE ${where} ORDER BY started_at DESC
        LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`,
    )
    .all(...params, limit, offset) as RecordingRow[];
  const total = (
    db.query(`SELECT COUNT(*) AS n FROM recordings WHERE ${where}`).get(...params) as { n: number }
  ).n;
  return { recordings, total };
}
