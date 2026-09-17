import type { Database } from "bun:sqlite";
import { db as defaultDb } from "../connection";
import type { Platform } from "../../types";
import { normalizeArchiveLogin } from "../../archive/targets";

export type ArchiveStatus =
  | "pending" // bot recorded the go-live; recorder has not picked it up yet
  | "recording" // recorder is capturing the live stream right now
  | "ended" // stream is over; parts may still be uploading
  | "uploading" // recording finished, remaining parts being sent
  | "done" // every part is in remote storage
  | "failed" // capture or upload gave up
  | "recovered"; // no live capture, but the VOD was retrieved after the fact

// The same set as a value: the read API validates `status` against it and the
// OpenAPI document enumerates it from here, so the two cannot drift.
export const ARCHIVE_STATUSES: ArchiveStatus[] = [
  "pending",
  "recording",
  "ended",
  "uploading",
  "done",
  "failed",
  "recovered",
];

export type PartStatus = "recorded" | "uploading" | "uploaded" | "failed";

// Statuses a broadcast can still transition out of. The recorder claims from
// this set on startup too, so a crash mid-stream does not strand a row.
const OPEN_STATUSES: ArchiveStatus[] = ["pending", "recording", "uploading"];

// Inlined rather than bound: these are code-controlled literals, and threading
// them through numbered placeholders alongside other arguments made the
// parameter indices in each query depend on the array's length.
const OPEN_STATUS_SQL = OPEN_STATUSES.map((s) => `'${s}'`).join(", ");

export interface VodArchive {
  id: number;
  platform: Platform;
  streamer_login: string;
  stream_id: string;
  title: string | null;
  started_at: string;
  ended_at: string | null;
  status: ArchiveStatus;
  error: string | null;
  live_m3u8: string | null;
  vod_m3u8: string | null;
  drive_folder: string | null;
  bytes: number;
  updated_at: string;
}

export interface VodArchivePart {
  archive_id: number;
  part_index: number;
  local_path: string | null;
  remote_path: string | null;
  bytes: number;
  status: PartStatus;
  error: string | null;
  updated_at: string;
}

export interface CreateArchiveInput {
  platform: Platform;
  streamerLogin: string;
  streamId: string;
  title?: string | null;
  startedAt: string;
}

function now(): string {
  return new Date().toISOString();
}

// Returns the existing row's id when the broadcast is already tracked. Both
// producers re-report the same stream — Kick every polling tick, Twitch on any
// EventSub redelivery — so "already known" is the normal case, not an error.
export function createArchive(
  input: CreateArchiveInput,
  db: Database = defaultDb,
): number {
  const timestamp = now();

  db.query(
    `INSERT INTO vod_archives
       (platform, streamer_login, stream_id, title, started_at, status, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6)
     ON CONFLICT (platform, streamer_login, stream_id) DO NOTHING`,
  ).run(
    input.platform,
    input.streamerLogin,
    input.streamId,
    input.title ?? null,
    input.startedAt,
    timestamp,
  );

  const row = db
    .query(
      "SELECT id FROM vod_archives WHERE platform = ?1 AND streamer_login = ?2 AND stream_id = ?3",
    )
    .get(input.platform, input.streamerLogin, input.streamId) as {
    id: number;
  } | null;

  // The row was just inserted or already existed, so this cannot miss.
  return row!.id;
}

// Twitch's stream.offline payload carries no stream id, so the open broadcast
// is located by streamer instead. Rows already past capture are left alone.
export function markEnded(
  platform: Platform,
  streamerLogin: string,
  db: Database = defaultDb,
): VodArchive | null {
  return (db
    .query(
      `UPDATE vod_archives
          SET ended_at = COALESCE(ended_at, ?1), updated_at = ?1
        WHERE id = (
          SELECT id FROM vod_archives
           WHERE platform = ?2 AND streamer_login = ?3
             AND status IN (${OPEN_STATUS_SQL})
           ORDER BY id DESC LIMIT 1
        )
        RETURNING *`,
    )
    .get(now(), platform, streamerLogin) ?? null) as VodArchive | null;
}

// Atomic claim: the UPDATE both selects and marks the row, so a recorder
// restarting mid-run cannot start a second capture of a broadcast already
// being handled.
export function claimNextArchive(db: Database = defaultDb): VodArchive | null {
  return (db
    .query(
      `UPDATE vod_archives
          SET status = 'recording', updated_at = ?1
        WHERE id = (
          SELECT id FROM vod_archives
           WHERE status = 'pending'
           ORDER BY id ASC LIMIT 1
        )
        RETURNING *`,
    )
    .get(now()) ?? null) as VodArchive | null;
}

export function updateArchive(
  id: number,
  patch: Partial<
    Pick<
      VodArchive,
      | "status"
      | "error"
      | "live_m3u8"
      | "vod_m3u8"
      | "drive_folder"
      | "bytes"
      | "ended_at"
    >
  >,
  db: Database = defaultDb,
): void {
  const columns = Object.keys(patch) as (keyof typeof patch)[];
  if (columns.length === 0) return;

  const assignments = columns.map((col, i) => `${col} = ?${i + 1}`).join(", ");
  const values = columns.map((col) => patch[col] ?? null);

  db.query(
    `UPDATE vod_archives
        SET ${assignments}, updated_at = ?${columns.length + 1}
      WHERE id = ?${columns.length + 2}`,
  ).run(...(values as any[]), now(), id);
}

export function getArchive(
  id: number,
  db: Database = defaultDb,
): VodArchive | null {
  return (db.query("SELECT * FROM vod_archives WHERE id = ?1").get(id) ??
    null) as VodArchive | null;
}

export function listArchives(
  limit = 100,
  db: Database = defaultDb,
): VodArchive[] {
  return db
    .query("SELECT * FROM vod_archives ORDER BY started_at DESC LIMIT ?1")
    .all(limit) as VodArchive[];
}

export function listOpenArchives(db: Database = defaultDb): VodArchive[] {
  return db
    .query(
      `SELECT * FROM vod_archives WHERE status IN (${OPEN_STATUS_SQL}) ORDER BY id ASC`,
    )
    .all() as VodArchive[];
}

export function recordPart(
  archiveId: number,
  partIndex: number,
  localPath: string,
  bytes: number,
  db: Database = defaultDb,
): void {
  db.query(
    `INSERT INTO vod_archive_parts
       (archive_id, part_index, local_path, bytes, status, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'recorded', ?5)
     ON CONFLICT (archive_id, part_index) DO UPDATE
       SET local_path = excluded.local_path,
           bytes = excluded.bytes,
           updated_at = excluded.updated_at`,
  ).run(archiveId, partIndex, localPath, bytes, now());
}

export function markPartStatus(
  archiveId: number,
  partIndex: number,
  status: PartStatus,
  extra: { remotePath?: string | null; error?: string | null } = {},
  db: Database = defaultDb,
): void {
  db.query(
    `UPDATE vod_archive_parts
        SET status = ?1,
            remote_path = COALESCE(?2, remote_path),
            error = ?3,
            updated_at = ?4
      WHERE archive_id = ?5 AND part_index = ?6`,
  ).run(
    status,
    extra.remotePath ?? null,
    extra.error ?? null,
    now(),
    archiveId,
    partIndex,
  );
}

export function getParts(
  archiveId: number,
  db: Database = defaultDb,
): VodArchivePart[] {
  return db
    .query(
      "SELECT * FROM vod_archive_parts WHERE archive_id = ?1 ORDER BY part_index ASC",
    )
    .all(archiveId) as VodArchivePart[];
}

// Parts still holding disk space. The uploader drains this on startup so a
// crash between "segment written" and "segment uploaded" does not leak files.
export function getPendingUploadParts(
  archiveId: number,
  db: Database = defaultDb,
): VodArchivePart[] {
  return db
    .query(
      `SELECT * FROM vod_archive_parts
        WHERE archive_id = ?1 AND status IN ('recorded', 'uploading', 'failed')
        ORDER BY part_index ASC`,
    )
    .all(archiveId) as VodArchivePart[];
}

export function countUploadedParts(
  archiveId: number,
  db: Database = defaultDb,
): number {
  return (
    db
      .query(
        "SELECT COUNT(*) AS count FROM vod_archive_parts WHERE archive_id = ?1 AND status = 'uploaded'",
      )
      .get(archiveId) as { count: number }
  ).count;
}

// ------------------------------------------------------------- read API
// The listing the read API serves (src/web/server.ts). The recorder's status
// page runs its own small query because it renders HTML; this one is the shape a
// client gets, with the same filter vocabulary the chat endpoints use.

export interface VodArchiveFilter {
  platform?: Platform;
  // The streamer's Twitch login or Kick slug, normalized the way the rows are.
  login?: string;
  status?: ArchiveStatus;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface VodArchiveListRow extends VodArchive {
  total_parts: number;
  uploaded_parts: number;
}

export interface VodArchivePage {
  archives: VodArchiveListRow[];
  total: number;
  limit: number;
  offset: number;
}

export const DEFAULT_ARCHIVE_PAGE = 100;
export const MAX_ARCHIVE_PAGE = 500;

// One LEFT JOIN rather than a query per archive: a broadcast that has not
// produced a segment yet still has to appear, with zero parts.
export function listVodArchivePage(
  filter: VodArchiveFilter = {},
  db: Database = defaultDb,
): VodArchivePage {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  const add = (condition: string, value: string | number) => {
    params.push(value);
    conditions.push(condition.replace("?", `?${params.length}`));
  };

  if (filter.platform) add("a.platform = ?", filter.platform);
  if (filter.login) {
    // Rows are stored normalized, so a Kick login typed with underscores has to
    // be turned into the slug it was stored as (see archive/targets.ts).
    const login = filter.platform
      ? normalizeArchiveLogin(filter.platform, filter.login)
      : filter.login.trim().toLowerCase();
    add("a.streamer_login = ?", login);
  }
  if (filter.status) add("a.status = ?", filter.status);
  if (filter.from) add("a.started_at >= ?", filter.from);
  if (filter.to) add("a.started_at <= ?", filter.to);

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(
    Math.max(1, filter.limit ?? DEFAULT_ARCHIVE_PAGE),
    MAX_ARCHIVE_PAGE,
  );
  const offset = Math.max(0, filter.offset ?? 0);

  const archives = db
    .query(
      `SELECT a.*,
              COUNT(p.archive_id) AS total_parts,
              SUM(CASE WHEN p.status = 'uploaded' THEN 1 ELSE 0 END) AS uploaded_parts
         FROM vod_archives a
         LEFT JOIN vod_archive_parts p ON p.archive_id = a.id
         ${where}
        GROUP BY a.id
        ORDER BY a.started_at DESC, a.id DESC
        LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`,
    )
    .all(...params, limit, offset) as VodArchiveListRow[];

  const total = (
    db
      .query(`SELECT COUNT(*) AS count FROM vod_archives a ${where}`)
      .get(...params) as { count: number }
  ).count;

  return {
    archives: archives.map((row) => ({
      ...row,
      // A SUM over no parts is null, not 0.
      uploaded_parts: row.uploaded_parts ?? 0,
    })),
    total,
    limit,
    offset,
  };
}
