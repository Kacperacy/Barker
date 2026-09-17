import type { Migration } from "./types";

// StreamRecorder.io's recordings, as the bot sees them.
//
// StreamRecorder records streams (Twitch, Kick and others) and publishes the
// newest recordings as JSON at /latestoffset/<offset>/<platformId>. That feed is
// global and cannot be filtered by channel, and a channel's own list is behind
// an account (/userrecordings answers 401), so the bot polls the feed and keeps
// the entries whose channel is one of STREAMRECORDER_CHANNELS. Their recording id
// is the primary key, which is what makes polling idempotent.
//
// `status` is their vocabulary ("finished", "recording", …) kept verbatim rather
// than mapped onto ours: a state this code does not recognise has to reach the
// site as itself instead of as a wrong label. `playback_url` is the signed MP4 a
// channel's page exposes for its newest recording — it expires, which is why
// `playback_resolved_at` is stored beside it.
const migration: Migration = {
  version: 7,
  name: "streamrecorder_vods",
  up(db) {
    db.query(
      `CREATE TABLE IF NOT EXISTS streamrecorder_vods (
        id INTEGER PRIMARY KEY,
        platform TEXT NOT NULL,
        target TEXT NOT NULL,
        target_id INTEGER,
        title TEXT,
        category TEXT,
        recorded_at TEXT NOT NULL,
        duration_seconds INTEGER,
        status TEXT NOT NULL,
        poster_url TEXT,
        page_url TEXT,
        playback_url TEXT,
        playback_resolved_at TEXT,
        viewers INTEGER,
        resolutions TEXT,
        received_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ).run();

    // Read newest-first per channel, the same access pattern the chat tables use.
    db.query(
      `CREATE INDEX IF NOT EXISTS idx_streamrecorder_vods_target_time
       ON streamrecorder_vods (platform, target, recorded_at DESC)`,
    ).run();

    db.query(
      `CREATE INDEX IF NOT EXISTS idx_streamrecorder_vods_status
       ON streamrecorder_vods (status, recorded_at DESC)`,
    ).run();
  },
};

export default migration;
