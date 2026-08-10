import { db } from "../connection";
import type { Platform } from "../../types";

// Individual (EventSub-driven) announcements use this sentinel instead of
// NULL for category_id, since SQLite treats NULL as distinct-from-itself in
// PRIMARY KEY uniqueness checks, which would break upserts for that row.
const NO_CATEGORY = "";

export interface LiveAnnouncement {
  guild_id: string;
  channel_id: string;
  streamer_login: string;
  category_id: string;
  streamer_name: string | null;
  message_id: string | null;
  platform: Platform;
}

export const saveLiveAnnouncement = (
  guildId: string,
  channelId: string,
  streamerLogin: string,
  categoryId: string | null,
  streamerName: string | null,
  messageId: string,
  platform: Platform,
) => {
  db.query(
    `INSERT OR REPLACE INTO live_announcements (guild_id, channel_id, streamer_login, category_id, streamer_name, message_id, platform)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  ).run(
    guildId,
    channelId,
    streamerLogin,
    categoryId ?? NO_CATEGORY,
    streamerName,
    messageId,
    platform,
  );
};

export const getLiveAnnouncement = (
  guildId: string,
  channelId: string,
  streamerLogin: string,
  categoryId: string | null,
  platform: Platform,
): LiveAnnouncement | null => {
  const res = db
    .query(
      "SELECT * FROM live_announcements WHERE guild_id = ?1 AND channel_id = ?2 AND streamer_login = ?3 AND category_id = ?4 AND platform = ?5",
    )
    .get(
      guildId,
      channelId,
      streamerLogin,
      categoryId ?? NO_CATEGORY,
      platform,
    ) as LiveAnnouncement | null;
  return res ?? null;
};

export const getLiveAnnouncementsForStreamer = (
  streamerLogin: string,
  categoryId: string | null,
  platform: Platform,
): LiveAnnouncement[] => {
  return db
    .query(
      "SELECT * FROM live_announcements WHERE streamer_login = ?1 AND category_id = ?2 AND platform = ?3",
    )
    .all(
      streamerLogin,
      categoryId ?? NO_CATEGORY,
      platform,
    ) as LiveAnnouncement[];
};

export const clearLiveAnnouncementsForStreamer = (
  streamerLogin: string,
  categoryId: string | null,
  platform: Platform,
) => {
  db.query(
    "DELETE FROM live_announcements WHERE streamer_login = ?1 AND category_id = ?2 AND platform = ?3",
  ).run(streamerLogin, categoryId ?? NO_CATEGORY, platform);
};

export const getNotifiedStreamerLoginsForCategory = (
  categoryId: string,
  platform: Platform,
): string[] => {
  const rows = db
    .query(
      "SELECT DISTINCT streamer_login FROM live_announcements WHERE category_id = ?1 AND platform = ?2",
    )
    .all(categoryId, platform) as { streamer_login: string }[];
  return rows.map((r) => r.streamer_login);
};
