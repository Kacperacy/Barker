import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";

const dbDir = "./db";
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const db = new Database(`${dbDir}/bot.sqlite`, { create: true });

db.query(
  `
  CREATE TABLE IF NOT EXISTS subscriptions (
    guild_id TEXT,
    channel_id TEXT,
    streamer_name TEXT,
    PRIMARY KEY (guild_id, streamer_name)
  )
`,
).run();

try {
  db.query("ALTER TABLE subscriptions ADD COLUMN custom_message TEXT").run();
} catch (e) {}

db.query(
  `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`,
).run();

export const setConfig = (key: string, value: string) => {
  db.query("INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)").run(
    key,
    value,
  );
};

export const getConfig = (key: string): string | null => {
  const res = db.query("SELECT value FROM config WHERE key = ?1").get(key) as {
    value: string;
  } | null;
  return res ? res.value : null;
};

export interface Subscription {
  guild_id: string;
  channel_id: string;
  streamer_name: string;
  custom_message?: string | null;
}

export const closeDatabase = () => {
  db.close();
};

export const addSubscription = (
  guildId: string,
  channelId: string,
  streamerName: string,
  customMessage: string | null = null,
) => {
  db.query(
    `
    INSERT OR REPLACE INTO subscriptions (guild_id, channel_id, streamer_name, custom_message) 
    VALUES (?1, ?2, ?3, ?4)
  `,
  ).run(guildId, channelId, streamerName.toLowerCase(), customMessage);
};

export const updateSubscriptionMessage = (
  guildId: string,
  streamerName: string,
  customMessage: string | null,
) => {
  db.query(
    `UPDATE subscriptions SET custom_message = ?1 WHERE guild_id = ?2 AND streamer_name = ?3`,
  ).run(customMessage, guildId, streamerName.toLowerCase());
};

export const removeSubscription = (guildId: string, streamerName: string) => {
  db.query(
    `
    DELETE FROM subscriptions 
    WHERE guild_id = ?1 AND streamer_name = ?2
  `,
  ).run(guildId, streamerName.toLowerCase());
};

export const getAllUniqueStreamers = (): string[] => {
  const res = db
    .query("SELECT DISTINCT streamer_name FROM subscriptions")
    .all() as { streamer_name: string }[];
  return res.map((row) => row.streamer_name);
};

export const getSubscriptionsForStreamer = (
  streamerName: string,
): Subscription[] => {
  return db
    .query("SELECT * FROM subscriptions WHERE streamer_name = ?1")
    .all(streamerName.toLowerCase()) as Subscription[];
};

export const getGuildSubscriptions = (guildId: string): Subscription[] => {
  return db
    .query("SELECT * FROM subscriptions WHERE guild_id = ?1")
    .all(guildId) as Subscription[];
};
