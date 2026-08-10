import { db } from "../connection";
import type { Platform } from "../../types";

export const addBlacklist = (
  guildId: string,
  streamerName: string,
  platform: Platform,
) => {
  db.query(
    "INSERT OR IGNORE INTO blacklisted_streamers (guild_id, streamer_name, platform) VALUES (?1, ?2, ?3)",
  ).run(guildId, streamerName.toLowerCase(), platform);
};

export const removeBlacklist = (
  guildId: string,
  streamerName: string,
  platform: Platform,
) => {
  db.query(
    "DELETE FROM blacklisted_streamers WHERE guild_id = ?1 AND streamer_name = ?2 AND platform = ?3",
  ).run(guildId, streamerName.toLowerCase(), platform);
};

export const isStreamerBlacklisted = (
  guildId: string,
  streamerName: string,
  platform: Platform,
): boolean => {
  const res = db
    .query(
      "SELECT 1 FROM blacklisted_streamers WHERE guild_id = ?1 AND streamer_name = ?2 AND platform = ?3",
    )
    .get(guildId, streamerName.toLowerCase(), platform);
  return !!res;
};

// Returns blacklist entries across all platforms for this guild — used by
// /list and autocomplete, which need to display/search everything together.
export const getGuildBlacklist = (
  guildId: string,
): { streamer_name: string; platform: Platform }[] => {
  return db
    .query(
      "SELECT streamer_name, platform FROM blacklisted_streamers WHERE guild_id = ?1",
    )
    .all(guildId) as { streamer_name: string; platform: Platform }[];
};
