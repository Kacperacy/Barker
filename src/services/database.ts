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

export interface Subscription {
  guild_id: string;
  channel_id: string;
  streamer_name: string;
}

export const closeDatabase = () => {
  db.close();
};

export const addSubscription = (
  guildId: string,
  channelId: string,
  streamerName: string,
) => {
  db.query(
    `
    INSERT OR REPLACE INTO subscriptions (guild_id, channel_id, streamer_name) 
    VALUES (?1, ?2, ?3)
  `,
  ).run(guildId, channelId, streamerName.toLowerCase());
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

export const getChannelsForStreamer = (streamerName: string): string[] => {
  const res = db
    .query("SELECT channel_id FROM subscriptions WHERE streamer_name = ?1")
    .all(streamerName.toLowerCase()) as { channel_id: string }[];
  return res.map((row) => row.channel_id);
};

export const getGuildSubscriptions = (guildId: string): Subscription[] => {
  return db
    .query("SELECT * FROM subscriptions WHERE guild_id = ?1")
    .all(guildId) as Subscription[];
};
