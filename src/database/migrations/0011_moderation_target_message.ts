import type { Migration } from "./types";

// A deletion names the message it removed, so the log can mark that message
// instead of listing the deletion on its own. Twitch's CLEARMSG rows already
// carry the id inside their event id (`delete:<message id>`); it is copied into
// the new column so both platforms are read the same way.
const migration: Migration = {
  version: 11,
  name: "moderation_target_message",
  up(db) {
    db.query("ALTER TABLE moderation_events ADD COLUMN target_message_id TEXT").run();

    db.query(
      `UPDATE moderation_events
         SET target_message_id = substr(event_id, 8)
       WHERE action = 'message_delete' AND event_id LIKE 'delete:%'`,
    ).run();

    db.query(
      `CREATE INDEX IF NOT EXISTS idx_moderation_events_target_message
       ON moderation_events (platform, target_message_id)
       WHERE target_message_id IS NOT NULL`,
    ).run();
  },
};

export default migration;
