import type { Migration } from "./types";

const migration: Migration = {
  version: 3,
  name: "unify_live_tracking",
  up(db) {
    db.query(
      `CREATE TABLE IF NOT EXISTS live_announcements (
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        streamer_login TEXT NOT NULL,
        category_id TEXT NOT NULL DEFAULT '',
        streamer_name TEXT,
        message_id TEXT,
        PRIMARY KEY (guild_id, channel_id, streamer_login, category_id)
      )`,
    ).run();

    db.query(
      `CREATE TABLE IF NOT EXISTS category_streamer_strikes (
        category_id TEXT NOT NULL,
        streamer_login TEXT NOT NULL,
        missing_strikes INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (category_id, streamer_login)
      )`,
    ).run();

    // Superseded by live_announcements / category_streamer_strikes above.
    // Their contents are transient "currently live" bookkeeping, not
    // durable user configuration, so dropping them loses nothing but a
    // few in-flight announcements, which naturally reconcile on the next poll.
    db.query("DROP TABLE IF EXISTS active_messages").run();
    db.query("DROP TABLE IF EXISTS category_notified").run();
  },
};

export default migration;
