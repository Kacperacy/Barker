import type { Migration } from "./types";

// Site accounts (Kick/Twitch login), viewer-marked stream highlights, and the
// moderation around them.
//
// - users: one row per platform account that logged in. No platform tokens are
//   kept: the login only proves who someone is.
// - sessions: the cookie holds a random token; only its SHA-256 is stored, so a
//   leaked database cannot be replayed as sessions.
// - oauth_states: the in-flight login (state + PKCE verifier), minutes long.
// - user_roles: moderators, granted by an admin. Admins come from config.
// - user_mutes: a mod's "may not mark highlights" sanction, timed or permanent.
// - highlights: one mark by one user at one real-world instant (`at`); marks
//   close together are grouped into a moment when read.
// - highlight_reports: one report per user per mark.
// - mod_actions: the audit log of every moderation action.
const migration: Migration = {
  version: 13,
  name: "accounts_highlights",
  up(db) {
    db.query(
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        platform_user_id TEXT NOT NULL,
        login TEXT NOT NULL,
        display TEXT,
        avatar TEXT,
        created_at TEXT NOT NULL,
        last_login_at TEXT NOT NULL,
        UNIQUE (platform, platform_user_id)
      )`,
    ).run();

    db.query(
      `CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,
    ).run();
    db.query("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)").run();

    db.query(
      `CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        code_verifier TEXT NOT NULL,
        return_to TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    ).run();

    db.query(
      `CREATE TABLE IF NOT EXISTS user_roles (
        user_id INTEGER PRIMARY KEY,
        role TEXT NOT NULL,
        granted_by INTEGER,
        granted_at TEXT NOT NULL
      )`,
    ).run();

    db.query(
      `CREATE TABLE IF NOT EXISTS user_mutes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        until TEXT,
        reason TEXT,
        by_user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        lifted_at TEXT
      )`,
    ).run();
    db.query("CREATE INDEX IF NOT EXISTS idx_user_mutes_user ON user_mutes (user_id)").run();

    db.query(
      `CREATE TABLE IF NOT EXISTS highlights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        channel_platform TEXT NOT NULL,
        channel_login TEXT NOT NULL,
        stream_id TEXT,
        at TEXT NOT NULL,
        source TEXT NOT NULL,
        kind TEXT NOT NULL,
        note TEXT,
        note_removed INTEGER NOT NULL DEFAULT 0,
        hidden INTEGER NOT NULL DEFAULT 0,
        hidden_reason TEXT,
        deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
    ).run();
    db.query(
      `CREATE INDEX IF NOT EXISTS idx_highlights_channel_at
       ON highlights (channel_platform, channel_login, at)`,
    ).run();
    db.query("CREATE INDEX IF NOT EXISTS idx_highlights_user ON highlights (user_id, created_at)").run();

    db.query(
      `CREATE TABLE IF NOT EXISTS highlight_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        highlight_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        resolved_by INTEGER,
        UNIQUE (highlight_id, user_id)
      )`,
    ).run();

    db.query(
      `CREATE TABLE IF NOT EXISTS mod_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id INTEGER,
        details TEXT,
        created_at TEXT NOT NULL
      )`,
    ).run();
  },
};

export default migration;
