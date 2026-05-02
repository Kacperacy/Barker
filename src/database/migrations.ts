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

  db.query(
    `CREATE TABLE IF NOT EXISTS category_subscriptions (
      guild_id TEXT,
      channel_id TEXT,
      category_id TEXT,
      category_name TEXT,
      language TEXT,
      custom_message TEXT,
      PRIMARY KEY (guild_id, category_id, language)
    )`,
  ).run();

  db.query(
    `CREATE TABLE IF NOT EXISTS category_notified (
      user_id TEXT,
      category_id TEXT,
      PRIMARY KEY (user_id, category_id)
    )`,
  ).run();
}
