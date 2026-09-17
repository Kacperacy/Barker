import type { Database } from "bun:sqlite";
import { db as defaultDb } from "../connection";
import type { Platform } from "../../types";

// Rows as stored. `status` is StreamRecorder's own word for the recording's
// state, kept verbatim (see migration 0007).
export interface StreamRecorderVodRow {
  id: number;
  platform: Platform;
  target: string;
  target_id: number | null;
  title: string | null;
  category: string | null;
  recorded_at: string;
  duration_seconds: number | null;
  status: string;
  poster_url: string | null;
  page_url: string | null;
  playback_url: string | null;
  playback_resolved_at: string | null;
  viewers: number | null;
  resolutions: string | null;
  received_at: string;
  updated_at: string;
}

export interface NewStreamRecorderVod {
  id: number;
  platform: Platform;
  target: string;
  targetId?: number | null;
  title?: string | null;
  category?: string | null;
  recordedAt: string;
  durationSeconds?: number | null;
  status: string;
  posterUrl?: string | null;
  pageUrl?: string | null;
  viewers?: number | null;
  resolutions?: number[] | null;
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

export const DEFAULT_VOD_PAGE = 100;
export const MAX_VOD_PAGE = 500;

function now(): string {
  return new Date().toISOString();
}

// One statement per row inside a transaction: a poll returns a page of a global
// feed and only the rows for our channels survive the filter, so the volume is
// small and the conflict clause is what makes a re-poll a no-op.
//
// `playback_url` is deliberately untouched here: it is resolved separately and
// expires, so an upsert must not wipe what the resolver stored.
export function upsertStreamRecorderVods(
  vods: NewStreamRecorderVod[],
  db: Database = defaultDb,
): number {
  if (vods.length === 0) return 0;

  const statement = db.query(
    `INSERT INTO streamrecorder_vods
       (id, platform, target, target_id, title, category, recorded_at,
        duration_seconds, status, poster_url, page_url, viewers, resolutions,
        received_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title,
       category = excluded.category,
       duration_seconds = excluded.duration_seconds,
       status = excluded.status,
       poster_url = excluded.poster_url,
       viewers = excluded.viewers,
       resolutions = excluded.resolutions,
       updated_at = excluded.updated_at`,
  );

  const timestamp = now();
  let written = 0;

  const run = db.transaction((rows: NewStreamRecorderVod[]) => {
    for (const vod of rows) {
      const result = statement.run(
        vod.id,
        vod.platform,
        vod.target,
        vod.targetId ?? null,
        vod.title ?? null,
        vod.category ?? null,
        vod.recordedAt,
        vod.durationSeconds ?? null,
        vod.status,
        vod.posterUrl ?? null,
        vod.pageUrl ?? null,
        vod.viewers ?? null,
        vod.resolutions ? JSON.stringify(vod.resolutions) : null,
        timestamp,
      );
      written += result.changes;
    }
  });

  run(vods);
  return written;
}

// The signed MP4 of a channel's newest recording, refreshed by the poller. Kept
// apart from the upsert because it comes from the channel's page, not the feed.
export function setVodPlaybackUrl(
  id: number,
  playbackUrl: string | null,
  db: Database = defaultDb,
): void {
  db.query(
    `UPDATE streamrecorder_vods
        SET playback_url = ?1, playback_resolved_at = ?2, updated_at = ?2
      WHERE id = ?3`,
  ).run(playbackUrl, now(), id);
}

export function getStreamRecorderVod(
  id: number,
  db: Database = defaultDb,
): StreamRecorderVodRow | null {
  return (db
    .query("SELECT * FROM streamrecorder_vods WHERE id = ?1")
    .get(id) ?? null) as StreamRecorderVodRow | null;
}

// The id we hold for a channel's newest recording — the only one whose playback
// a public page exposes.
export function latestVodIdForTarget(
  platform: Platform,
  target: string,
  db: Database = defaultDb,
): number | null {
  const row = db
    .query(
      `SELECT id FROM streamrecorder_vods
        WHERE platform = ?1 AND target = ?2
        ORDER BY recorded_at DESC, id DESC
        LIMIT 1`,
    )
    .get(platform, target) as { id: number } | null;

  return row?.id ?? null;
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
        ORDER BY recorded_at DESC, id DESC
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

// What the poller has collected, for a startup log or for a caller that wants to
// know which channels have recordings.
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

