import { db } from "../connection";

export interface Subscription {
  guild_id: string;
  channel_id: string;
  streamer_name: string;
  custom_message?: string | null;
}

export const addSubscription = (
  guildId: string,
  channelId: string,
  streamerName: string,
  customMessage: string | null = null,
) => {
  db.query(
    `INSERT OR REPLACE INTO subscriptions (guild_id, channel_id, streamer_name, custom_message) VALUES (?1, ?2, ?3, ?4)`,
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
    `DELETE FROM subscriptions WHERE guild_id = ?1 AND streamer_name = ?2`,
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
