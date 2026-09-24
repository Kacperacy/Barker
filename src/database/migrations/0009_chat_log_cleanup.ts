import type { Migration } from "./types";

// Two ingest bugs left rows that read wrong; the ingest is fixed, this repairs
// what was already stored.
//
// - Twitch chat lines carry the sender's login only in the IRC prefix, which the
//   parser used to drop, so every Twitch message was stored with no login. The
//   display name is the login in its chosen casing unless it is localized, so it
//   is only copied back when it is plain ASCII.
// - Kick fills an empty ban reason with "No reason provided"; stored, it reads
//   like a reason someone typed.
const migration: Migration = {
  version: 9,
  name: "chat_log_cleanup",
  up(db) {
    db.query(
      `UPDATE chat_messages
         SET sender_login = lower(sender_display)
       WHERE platform = 'twitch'
         AND sender_login IS NULL
         AND sender_display IS NOT NULL
         AND sender_display NOT GLOB '*[^A-Za-z0-9_]*'`,
    ).run();

    db.query(
      `UPDATE moderation_events
         SET reason = NULL
       WHERE lower(trim(reason)) = 'no reason provided' OR trim(reason) = ''`,
    ).run();
  },
};

export default migration;
