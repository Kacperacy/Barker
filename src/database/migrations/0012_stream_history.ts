import type { Migration } from "./types";

// Stream history: one row per broadcast of a logged channel, plus a viewer-count
// sample per poll. The chat log already stamps each message with its broadcast
// (chat/live.ts), so the streams it has seen are backfilled from it — without
// titles or viewers, which were never recorded, but with their start and the
// last message as the best known end.
const migration: Migration = {
  version: 12,
  name: "stream_history",
  up(db) {
    db.query(
      `CREATE TABLE IF NOT EXISTS streams (
        platform TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        broadcaster_login TEXT NOT NULL,
        title TEXT,
        category TEXT,
        started_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        ended_at TEXT,
        peak_viewers INTEGER,
        PRIMARY KEY (platform, stream_id)
      )`,
    ).run();

    db.query(
      `CREATE INDEX IF NOT EXISTS idx_streams_channel
       ON streams (platform, broadcaster_login, started_at DESC)`,
    ).run();

    db.query(
      `CREATE TABLE IF NOT EXISTS stream_viewer_samples (
        platform TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        at TEXT NOT NULL,
        viewers INTEGER NOT NULL,
        PRIMARY KEY (platform, stream_id, at)
      )`,
    ).run();

    db.query(
      `INSERT OR IGNORE INTO streams
         (platform, stream_id, broadcaster_login, started_at, last_seen_at, ended_at)
       SELECT platform, stream_id, broadcaster_login,
              MIN(COALESCE(stream_started_at, sent_at)), MAX(sent_at), MAX(sent_at)
         FROM chat_messages
        WHERE stream_id IS NOT NULL
        GROUP BY platform, stream_id`,
    ).run();
  },
};

export default migration;
