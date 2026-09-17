import type { Migration } from "./types";

// Chat logging: one row per chat message and one per moderation action, for the
// channels listed in CHAT_LOG_CHANNELS.
//
// Both platforms only hand messages over as they happen — Kick's public API has
// no chat-read endpoint at all and Twitch publishes no message history — so this
// log is forward-only by nature. There is nothing to backfill it from.
//
// The stream columns are what the later "chat beside the VOD" step needs: they
// tie a message to the broadcast it was sent during and to its offset from
// go-live, which is exactly what a player has to know to line the two up.
const migration: Migration = {
  version: 6,
  name: "chat_logging",
  up(db) {
    db.query(
      `CREATE TABLE IF NOT EXISTS chat_messages (
        platform TEXT NOT NULL,
        message_id TEXT NOT NULL,
        broadcaster_login TEXT NOT NULL,
        stream_id TEXT,
        stream_started_at TEXT,
        offset_seconds INTEGER,
        sent_at TEXT NOT NULL,
        sender_user_id TEXT,
        sender_login TEXT,
        sender_display TEXT,
        sender_color TEXT,
        badges TEXT,
        content TEXT NOT NULL,
        reply_to_message_id TEXT,
        received_at TEXT NOT NULL,
        PRIMARY KEY (platform, message_id)
      )`,
    ).run();

    // The subpage reads newest-first per channel, so the sort column is part of
    // the index rather than something SQLite has to do after the lookup.
    db.query(
      `CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_time
       ON chat_messages (platform, broadcaster_login, sent_at DESC)`,
    ).run();

    db.query(
      `CREATE INDEX IF NOT EXISTS idx_chat_messages_sender
       ON chat_messages (platform, sender_login)`,
    ).run();

    db.query(
      `CREATE INDEX IF NOT EXISTS idx_chat_messages_stream
       ON chat_messages (platform, broadcaster_login, stream_id, offset_seconds)`,
    ).run();

    // Bans and timeouts. `event_id` is the platform's own delivery id
    // (Kick-Event-Message-Id on Kick, the notification id on Twitch): both
    // platforms are at-least-once, so uniqueness is enforced in the schema
    // instead of in a read-then-write race.
    db.query(
      `CREATE TABLE IF NOT EXISTS moderation_events (
        platform TEXT NOT NULL,
        event_id TEXT NOT NULL,
        broadcaster_login TEXT NOT NULL,
        stream_id TEXT,
        action TEXT NOT NULL,
        target_user_id TEXT,
        target_login TEXT,
        target_display TEXT,
        actor_login TEXT,
        reason TEXT,
        duration_minutes INTEGER,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        PRIMARY KEY (platform, event_id)
      )`,
    ).run();

    db.query(
      `CREATE INDEX IF NOT EXISTS idx_moderation_events_channel_time
       ON moderation_events (platform, broadcaster_login, created_at DESC)`,
    ).run();

    db.query(
      `CREATE INDEX IF NOT EXISTS idx_moderation_events_action
       ON moderation_events (platform, action, created_at DESC)`,
    ).run();
  },
};

export default migration;
