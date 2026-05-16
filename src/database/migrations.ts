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

  db.query(
    `CREATE TABLE IF NOT EXISTS blacklisted_streamers (
      guild_id TEXT,
      streamer_name TEXT,
      PRIMARY KEY (guild_id, streamer_name)
    )`,
  ).run();

  db.query(
    `CREATE TABLE IF NOT EXISTS lol_subscriptions (
      guild_id TEXT,
      channel_id TEXT,
      puuid TEXT,
      riot_id TEXT,
      region TEXT,
      PRIMARY KEY (guild_id, puuid)
    )`,
  ).run();

  db.query(
    `CREATE TABLE IF NOT EXISTS lol_last_matches (
      puuid TEXT PRIMARY KEY,
      match_id TEXT,
      tier TEXT,
      rank TEXT,
      league_points INTEGER
    )`,
  ).run();
}
