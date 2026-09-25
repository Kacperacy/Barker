import type { Migration } from "./types";

// Recordings (VODs) of the logged channels on both platforms, synced from the
// platforms' own lists (recordings/sync.ts). The site finds "the recording
// covering this second" here, which is what lets a short, platform-neutral link
// (/m/<time>, /vod/<start>) open the right video on Kick or Twitch.
//
// `source_url` is Kick's HLS master playlist; Twitch recordings play in
// Twitch's own embed by `video_id`. `gone_at` marks a recording the platform no
// longer lists (deleted or expired), kept so old links can explain it.
const migration: Migration = {
  version: 14,
  name: "recordings",
  up(db) {
    db.query(
      `CREATE TABLE IF NOT EXISTS recordings (
        platform TEXT NOT NULL,
        video_id TEXT NOT NULL,
        channel_login TEXT NOT NULL,
        stream_id TEXT,
        title TEXT,
        category TEXT,
        started_at TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        source_url TEXT,
        thumbnail_url TEXT,
        views INTEGER,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        gone_at TEXT,
        PRIMARY KEY (platform, video_id)
      )`,
    ).run();
    db.query(
      `CREATE INDEX IF NOT EXISTS idx_recordings_channel_start
       ON recordings (platform, channel_login, started_at DESC)`,
    ).run();
  },
};

export default migration;
