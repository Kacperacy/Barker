import { db } from "../connection";
import type { Platform } from "../../types";

export interface Subscription {
  guild_id: string;
  channel_id: string;
  streamer_name: string;
  custom_message?: string | null;
  platform: Platform;
}

export const addSubscription = (
  guildId: string,
  channelId: string,
  streamerName: string,
  customMessage: string | null,
  platform: Platform,
) => {
  db.query(
    `INSERT OR REPLACE INTO subscriptions (guild_id, channel_id, streamer_name, custom_message, platform) VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).run(
    guildId,
    channelId,
    streamerName.toLowerCase(),
    customMessage,
    platform,
  );
};

export const updateSubscriptionMessage = (
  guildId: string,
  streamerName: string,
  customMessage: string | null,
  platform: Platform,
) => {
  db.query(
    `UPDATE subscriptions SET custom_message = ?1 WHERE guild_id = ?2 AND streamer_name = ?3 AND platform = ?4`,
  ).run(customMessage, guildId, streamerName.toLowerCase(), platform);
};

export const removeSubscription = (
  guildId: string,
  streamerName: string,
  platform: Platform,
) => {
  db.query(
    `DELETE FROM subscriptions WHERE guild_id = ?1 AND streamer_name = ?2 AND platform = ?3`,
  ).run(guildId, streamerName.toLowerCase(), platform);
};

export const getAllUniqueStreamers = (platform: Platform): string[] => {
  const res = db
    .query(
      "SELECT DISTINCT streamer_name FROM subscriptions WHERE platform = ?1",
    )
    .all(platform) as { streamer_name: string }[];
  return res.map((row) => row.streamer_name);
};

export const getSubscriptionsForStreamer = (
  streamerName: string,
  platform: Platform,
): Subscription[] => {
  return db
    .query(
      "SELECT * FROM subscriptions WHERE streamer_name = ?1 AND platform = ?2",
    )
    .all(streamerName.toLowerCase(), platform) as Subscription[];
};

// Returns subscriptions across all platforms for this guild — used by
// /list and autocomplete, which need to display/search everything together.
export const getGuildSubscriptions = (guildId: string): Subscription[] => {
  return db
    .query("SELECT * FROM subscriptions WHERE guild_id = ?1")
    .all(guildId) as Subscription[];
};

export const hasIndividualSubscription = (
  guildId: string,
  streamerName: string,
  platform: Platform,
): boolean => {
  const res = db
    .query(
      "SELECT 1 FROM subscriptions WHERE guild_id = ?1 AND streamer_name = ?2 AND platform = ?3",
    )
    .get(guildId, streamerName.toLowerCase(), platform);
  return !!res;
};
