import { db } from "../connection";

export interface LoLSubscription {
  guild_id: string;
  channel_id: string;
  puuid: string;
  riot_id: string;
  region: string;
}

export interface LoLPlayerMatch {
  puuid: string;
  match_id: string;
  kills: number;
  deaths: number;
  assists: number;
  win: number;
  duration: number;
  is_remake: number;
  timestamp: number;
  raw_json: string;
}

export const addLoLSubscription = (
  guildId: string,
  channelId: string,
  puuid: string,
  riotId: string,
  region: string,
) => {
  db.query(
    `INSERT OR REPLACE INTO lol_subscriptions (guild_id, channel_id, puuid, riot_id, region) VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).run(guildId, channelId, puuid, riotId, region);
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
  region: string;
}[] => {
  return db
    .query(
      "SELECT puuid, MAX(riot_id) as riot_id, MAX(region) as region FROM lol_subscriptions GROUP BY puuid",
    )
    .all() as { puuid: string; riot_id: string; region: string }[];
};

export const getSubscriptionsForLoLPlayer = (
  puuid: string,
): LoLSubscription[] => {
  return db
    .query("SELECT * FROM lol_subscriptions WHERE puuid = ?1")
    .all(puuid) as LoLSubscription[];
};

export const updateLastMatch = (
  puuid: string,
  matchId: string,
  tier: string | null,
  rank: string | null,
  lp: number | null,
) => {
  db.query(
    `INSERT OR REPLACE INTO lol_last_matches (puuid, match_id, tier, rank, league_points) VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).run(puuid, matchId, tier, rank, lp);
};

export const getLastMatch = (
  puuid: string,
): {
  match_id: string;
  tier: string;
  rank: string;
  league_points: number;
} | null => {
  const res = db
    .query(
      "SELECT match_id, tier, rank, league_points FROM lol_last_matches WHERE puuid = ?1",
    )
    .get(puuid) as any;
  return res ? res : null;
};

export const saveLoLPlayerMatch = (match: LoLPlayerMatch) => {
  db.query(
    `INSERT OR IGNORE INTO lol_player_matches (puuid, match_id, kills, deaths, assists, win, duration, is_remake, timestamp, raw_json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  ).run(
    match.puuid,
    match.match_id,
    match.kills,
    match.deaths,
    match.assists,
    match.win,
    match.duration,
    match.is_remake,
    match.timestamp,
    match.raw_json,
  );
};

export const getPlayerMatchesSince = (
  puuid: string,
  timestampMs: number,
): LoLPlayerMatch[] => {
  return db
    .query(
      "SELECT * FROM lol_player_matches WHERE puuid = ?1 AND timestamp >= ?2",
    )
    .all(puuid, timestampMs) as LoLPlayerMatch[];
};

export const getAllLoLChannels = (): { channel_id: string }[] => {
  return db
    .query("SELECT DISTINCT channel_id FROM lol_subscriptions")
    .all() as { channel_id: string }[];
};

export const getLoLSubscriptionsByChannel = (
  channelId: string,
): LoLSubscription[] => {
  return db
    .query("SELECT * FROM lol_subscriptions WHERE channel_id = ?1")
    .all(channelId) as LoLSubscription[];
};
