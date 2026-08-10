import type { Database } from "bun:sqlite";
import type { Migration } from "./types";

// SQLite can't widen a PRIMARY KEY via ALTER TABLE, so each table is rebuilt:
// rename old -> create new (with `platform`) -> copy rows (defaulting to
// 'twitch', preserving every existing row untouched) -> drop old.
//
// `expectedColumns` is only the *expected* pre-migration shape — the actual
// columns present are read via PRAGMA and intersected with it, since a
// real-world database can have drifted from what migration 0001 assumes
// (e.g. a table created even earlier, before a column existed, where a
// later `CREATE TABLE IF NOT EXISTS` silently never added it). Any column
// missing from the real table is simply left NULL in the new one, which is
// the correct value for "was never set" — safer than assuming the schema.
function addPlatformAndWidenPk(
  db: Database,
  table: string,
  createNewTableSql: string,
  expectedColumns: string[],
) {
  const columns = db.query(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (columns.some((c) => c.name === "platform")) return;

  const existingColumnNames = new Set(columns.map((c) => c.name));
  const columnsToCopy = expectedColumns.filter((c) =>
    existingColumnNames.has(c),
  );

  const oldTable = `${table}_old`;
  db.query(`ALTER TABLE ${table} RENAME TO ${oldTable}`).run();
  db.query(createNewTableSql).run();
  db.query(
    `INSERT INTO ${table} (${columnsToCopy.join(", ")}, platform)
     SELECT ${columnsToCopy.join(", ")}, 'twitch' FROM ${oldTable}`,
  ).run();
  db.query(`DROP TABLE ${oldTable}`).run();
}

const migration: Migration = {
  version: 4,
  name: "add_platform_support",
  up(db) {
    addPlatformAndWidenPk(
      db,
      "subscriptions",
      `CREATE TABLE subscriptions (
        guild_id TEXT,
        channel_id TEXT,
        streamer_name TEXT,
        custom_message TEXT,
        platform TEXT NOT NULL DEFAULT 'twitch',
        PRIMARY KEY (guild_id, streamer_name, platform)
      )`,
      ["guild_id", "channel_id", "streamer_name", "custom_message"],
    );

    addPlatformAndWidenPk(
      db,
      "category_subscriptions",
      `CREATE TABLE category_subscriptions (
        guild_id TEXT,
        channel_id TEXT,
        category_id TEXT,
        category_name TEXT,
        language TEXT,
        custom_message TEXT,
        platform TEXT NOT NULL DEFAULT 'twitch',
        PRIMARY KEY (guild_id, category_id, language, platform)
      )`,
      [
        "guild_id",
        "channel_id",
        "category_id",
        "category_name",
        "language",
        "custom_message",
      ],
    );

    addPlatformAndWidenPk(
      db,
      "blacklisted_streamers",
      `CREATE TABLE blacklisted_streamers (
        guild_id TEXT,
        streamer_name TEXT,
        platform TEXT NOT NULL DEFAULT 'twitch',
        PRIMARY KEY (guild_id, streamer_name, platform)
      )`,
      ["guild_id", "streamer_name"],
    );

    addPlatformAndWidenPk(
      db,
      "live_announcements",
      `CREATE TABLE live_announcements (
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        streamer_login TEXT NOT NULL,
        category_id TEXT NOT NULL DEFAULT '',
        streamer_name TEXT,
        message_id TEXT,
        platform TEXT NOT NULL DEFAULT 'twitch',
        PRIMARY KEY (guild_id, channel_id, streamer_login, category_id, platform)
      )`,
      [
        "guild_id",
        "channel_id",
        "streamer_login",
        "category_id",
        "streamer_name",
        "message_id",
      ],
    );

    addPlatformAndWidenPk(
      db,
      "category_streamer_strikes",
      `CREATE TABLE category_streamer_strikes (
        category_id TEXT NOT NULL,
        streamer_login TEXT NOT NULL,
        missing_strikes INTEGER NOT NULL DEFAULT 0,
        platform TEXT NOT NULL DEFAULT 'twitch',
        PRIMARY KEY (category_id, streamer_login, platform)
      )`,
      ["category_id", "streamer_login", "missing_strikes"],
    );
  },
};

export default migration;
