import type { Database } from "bun:sqlite";
import { db as defaultDb } from "../connection";
import type { Platform } from "../../types";

export type ArchiveStatus =
  | "pending" // bot recorded the go-live; recorder has not picked it up yet
  | "recording" // recorder is capturing the live stream right now
  | "ended" // stream is over; parts may still be uploading
  | "uploading" // recording finished, remaining parts being sent
  | "done" // every part is in remote storage
  | "failed" // capture or upload gave up
  | "recovered"; // no live capture, but the VOD was retrieved after the fact

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
