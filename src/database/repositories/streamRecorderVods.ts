import type { Database } from "bun:sqlite";
import { db as defaultDb } from "../connection";
import type { Platform } from "../../types";

// Rows as stored. `status` is StreamRecorder's own state in words: "live" while
// they are recording that channel, "finished" for everything else. It is the only
// status they publish, and it is kept in their terms (see migration 0008).
export interface StreamRecorderVodRow {
  key: string;
  platform: Platform;
  target: string;
  title: string;
  category: string | null;
  recorded_at: string;
  duration_seconds: number;
  status: string;
  thumbnail_url: string | null;
  page_url: string;
  playback_url: string | null;
  playback_resolved_at: string | null;
  received_at: string;
  updated_at: string;
}

// What the poller hands over. No media: a row is metadata about a recording that
// lives on StreamRecorder's side, or has already gone from it.
export interface NewStreamRecorderVod {
  key: string;
  platform: Platform;
  target: string;
  title: string;
  category?: string | null;
  recordedAt: string;
  durationSeconds: number;
  status: string;
  thumbnailUrl?: string | null;
  pageUrl: string;
}

export interface StreamRecorderVodFilter {
  platform?: Platform;
  target?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

// A channel's profile shows what it has, so one page is normally the whole
// archive: the default is generous rather than small.
export const DEFAULT_VOD_PAGE = 500;
export const MAX_VOD_PAGE = 1000;

function now(): string {
  return new Date().toISOString();
}

// One statement per row inside a transaction. `playback_url` is deliberately not
// written here: it is resolved separately and expires, so a poll must not wipe a
// URL that is still good.
export function upsertStreamRecorderVods(
  vods: NewStreamRecorderVod[],
  db: Database = defaultDb,
): number {
  if (vods.length === 0) return 0;

  const statement = db.query(
    `INSERT INTO streamrecorder_vods
       (key, platform, target, title, category, recorded_at, duration_seconds,
        status, thumbnail_url, page_url, received_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)
     ON CONFLICT (key) DO UPDATE SET
       title = excluded.title,
       category = excluded.category,
       duration_seconds = excluded.duration_seconds,
       status = excluded.status,
       thumbnail_url = excluded.thumbnail_url,
       page_url = excluded.page_url,
       updated_at = excluded.updated_at`,
  );

  const timestamp = now();
  let written = 0;

  const run = db.transaction((rows: NewStreamRecorderVod[]) => {
    for (const vod of rows) {
      const result = statement.run(
        vod.key,
        vod.platform,
        vod.target,
        vod.title,
        vod.category ?? null,
        vod.recordedAt,
        vod.durationSeconds,
        vod.status,
        vod.thumbnailUrl ?? null,
        vod.pageUrl,
        timestamp,
      );
      written += result.changes;
    }
  });

  run(vods);
  return written;
}

// The signed MP4 of the recording the profile's player is showing. Only that one
// recording has a public source, so the poller sets it here and clears it from the
// channel's other rows (see clearPlaybackForTarget).
export function setVodPlaybackUrl(
  key: string,
  playbackUrl: string,
  db: Database = defaultDb,
): void {
  db.query(
    `UPDATE streamrecorder_vods
        SET playback_url = ?1, playback_resolved_at = ?2, updated_at = ?2
      WHERE key = ?3`,
  ).run(playbackUrl, now(), key);
}

export function clearPlaybackForTarget(
  platform: Platform,
  target: string,
  keepKey: string,
  db: Database = defaultDb,
): void {
  db.query(
    `UPDATE streamrecorder_vods
        SET playback_url = NULL, playback_resolved_at = NULL, updated_at = ?1
      WHERE platform = ?2 AND target = ?3 AND key != ?4 AND playback_url IS NOT NULL`,
  ).run(now(), platform, target, keepKey);
}

export interface StreamRecorderVodPage {
  vods: StreamRecorderVodRow[];
  total: number;
  limit: number;
  offset: number;
}

// The read API's query, with the same filter vocabulary as the chat endpoints.
export function listStreamRecorderVods(
  filter: StreamRecorderVodFilter = {},
  db: Database = defaultDb,
): StreamRecorderVodPage {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  const add = (condition: string, value: string | number) => {
    params.push(value);
    conditions.push(condition.replace("?", `?${params.length}`));
  };

  if (filter.platform) add("platform = ?", filter.platform);
  if (filter.target) add("target = ?", filter.target.trim().toLowerCase());
  if (filter.status) add("status = ?", filter.status);
  if (filter.from) add("recorded_at >= ?", filter.from);
  if (filter.to) add("recorded_at <= ?", filter.to);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(
    Math.max(1, filter.limit ?? DEFAULT_VOD_PAGE),
    MAX_VOD_PAGE,
  );
  const offset = Math.max(0, filter.offset ?? 0);

  const vods = db
    .query(
      `SELECT * FROM streamrecorder_vods ${where}
        ORDER BY recorded_at DESC, key DESC
        LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`,
    )
    .all(...params, limit, offset) as StreamRecorderVodRow[];

  const total = (
    db
      .query(`SELECT COUNT(*) AS count FROM streamrecorder_vods ${where}`)
      .get(...params) as { count: number }
  ).count;

  return { vods, total, limit, offset };
}

// Which channels have recordings stored, with counts: what the startup log and a
// client building a filter both want.
export function listStoredVodChannels(
  db: Database = defaultDb,
): { platform: Platform; target: string; vods: number }[] {
  return db
    .query(
      `SELECT platform, target, COUNT(*) AS vods
         FROM streamrecorder_vods
        GROUP BY platform, target
        ORDER BY platform, target`,
    )
    .all() as { platform: Platform; target: string; vods: number }[];
}

