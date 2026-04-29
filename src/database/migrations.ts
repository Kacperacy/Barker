import { db } from "./connection";

export function runMigrations() {
  db.query(
    `CREATE TABLE IF NOT EXISTS subscriptions (
      guild_id TEXT,
      channel_id TEXT,
      streamer_name TEXT,
      custom_message TEXT,
      PRIMARY KEY (guild_id, streamer_name)
    )`,
  ).run();

  db.query(
    `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`,
  ).run();

  db.query(
    `CREATE TABLE IF NOT EXISTS active_messages (
      streamer_name TEXT,
      channel_id TEXT,
      message_id TEXT,
      PRIMARY KEY (streamer_name, channel_id)
    )`,
  ).run();
}
