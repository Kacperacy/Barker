import { db } from "../connection";

export const addBlacklist = (guildId: string, streamerName: string) => {
  db.query(
    "INSERT OR IGNORE INTO blacklisted_streamers (guild_id, streamer_name) VALUES (?1, ?2)",
  ).run(guildId, streamerName.toLowerCase());
};

export const removeBlacklist = (guildId: string, streamerName: string) => {
  db.query(
    "DELETE FROM blacklisted_streamers WHERE guild_id = ?1 AND streamer_name = ?2",
  ).run(guildId, streamerName.toLowerCase());
};

export const isStreamerBlacklisted = (
  guildId: string,
  streamerName: string,
): boolean => {
  const res = db
    .query(
      "SELECT 1 FROM blacklisted_streamers WHERE guild_id = ?1 AND streamer_name = ?2",
    )
    .get(guildId, streamerName.toLowerCase());
  return !!res;
};

export const getGuildBlacklist = (
  guildId: string,
): { streamer_name: string }[] => {
  return db
    .query(
      "SELECT streamer_name FROM blacklisted_streamers WHERE guild_id = ?1",
    )
    .all(guildId) as { streamer_name: string }[];
};
