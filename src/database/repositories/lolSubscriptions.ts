import { db } from "../connection";

export interface LoLSubscription {
  guild_id: string;
  channel_id: string;
  puuid: string;
  riot_id: string;
}

export const addLoLSubscription = (
  guildId: string,
  channelId: string,
  puuid: string,
  riotId: string,
) => {
  db.query(
    `INSERT OR REPLACE INTO lol_subscriptions (guild_id, channel_id, puuid, riot_id) VALUES (?1, ?2, ?3, ?4)`,
  ).run(guildId, channelId, puuid, riotId);
};

export const removeLoLSubscription = (guildId: string, puuid: string) => {
  db.query(
    `DELETE FROM lol_subscriptions WHERE guild_id = ?1 AND puuid = ?2`,
  ).run(guildId, puuid);
};

export const getGuildLoLSubscriptions = (
  guildId: string,
): LoLSubscription[] => {
  return db
    .query("SELECT * FROM lol_subscriptions WHERE guild_id = ?1")
    .all(guildId) as LoLSubscription[];
};

export const getAllUniqueLoLPlayers = (): {
  puuid: string;
  riot_id: string;
}[] => {
  return db
    .query("SELECT DISTINCT puuid, riot_id FROM lol_subscriptions")
    .all() as { puuid: string; riot_id: string }[];
};

export const getSubscriptionsForLoLPlayer = (
  puuid: string,
): LoLSubscription[] => {
  return db
    .query("SELECT * FROM lol_subscriptions WHERE puuid = ?1")
    .all(puuid) as LoLSubscription[];
};

export const updateLastMatch = (puuid: string, matchId: string) => {
  db.query(
    `INSERT OR REPLACE INTO lol_last_matches (puuid, match_id) VALUES (?1, ?2)`,
  ).run(puuid, matchId);
};

export const getLastMatch = (puuid: string): string | null => {
  const res = db
    .query("SELECT match_id FROM lol_last_matches WHERE puuid = ?1")
    .get(puuid) as { match_id: string } | null;
  return res ? res.match_id : null;
};
