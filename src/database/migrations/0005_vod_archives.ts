import type { Migration } from "./types";

// One row per broadcast being archived, plus one row per recorded segment.
//
// The split matters for more than normalization: recordings are cut into
// segments precisely so each one can be uploaded and deleted while the stream
// is still running, keeping peak disk usage at roughly one segment instead of
// the whole broadcast. Per-part rows are what make that resumable — after a
// restart, already-uploaded parts are known and are neither re-sent nor
// re-deleted.
const migration: Migration = {
  version: 5,
  name: "vod_archives",
  up(db) {
    db.query(
      `CREATE TABLE IF NOT EXISTS vod_archives (
        id INTEGER PRIMARY KEY,
        platform TEXT NOT NULL,
        streamer_login TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        title TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT NOT NULL,
        error TEXT,
        live_m3u8 TEXT,
        vod_m3u8 TEXT,
        drive_folder TEXT,
        bytes INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`,
    ).run();

    // The Kick polling loop re-reports the same livestream every tick, and
    // Twitch can redeliver an EventSub notification; both must be no-ops
    // rather than new archives, so uniqueness is enforced in the schema
    // instead of in a read-then-write race.
    db.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_vod_archives_stream
       ON vod_archives (platform, streamer_login, stream_id)`,
    ).run();

    // The recorder claims work by scanning for unfinished archives.
    db.query(
      `CREATE INDEX IF NOT EXISTS idx_vod_archives_status
       ON vod_archives (status)`,
    ).run();

    db.query(
      `CREATE TABLE IF NOT EXISTS vod_archive_parts (
        archive_id INTEGER NOT NULL REFERENCES vod_archives(id) ON DELETE CASCADE,
        part_index INTEGER NOT NULL,
        local_path TEXT,
        remote_path TEXT,
        bytes INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (archive_id, part_index)
      )`,
    ).run();

    db.query(
      `CREATE INDEX IF NOT EXISTS idx_vod_archive_parts_status
       ON vod_archive_parts (status)`,
    ).run();
  },
};

export default migration;
