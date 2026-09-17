import type { Migration } from "./types";

// StreamRecorder.io's recordings, as the bot sees them.
//
// 0007 modelled a row on their global feed, which carries a numeric recording id.
// Their profile page — the only public place a channel's own recordings actually
// appear — publishes no id per entry, so a row's key is derived from what it does
// publish: the day, the time and the title. The table 0007 created never held a
// row (its source turned out not to contain small channels at all), so replacing
// it costs nothing; the drop is written to be harmless either way.
//
// `status` is their `is_live` flag in words — "live" while a recording is being
// made, "finished" for everything else. It is the only status they publish, and
// it is kept in their terms rather than mapped onto ours.
//
// Nothing here holds video: `playback_url` is the signed MP4 their profile
// exposes for the recording its player is showing, and it expires, which is why
// `playback_resolved_at` sits beside it.
const migration: Migration = {
  version: 8,
  name: "streamrecorder_vods_from_profiles",
  up(db) {
    db.query("DROP TABLE IF EXISTS streamrecorder_vods").run();

    db.query(
      `CREATE TABLE IF NOT EXISTS streamrecorder_vods (
        key TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        target TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT,
        recorded_at TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        status TEXT NOT NULL,
        thumbnail_url TEXT,
        page_url TEXT NOT NULL,
        playback_url TEXT,
        playback_resolved_at TEXT,
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
