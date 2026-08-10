import { db } from "../connection";
import type { Platform } from "../../types";

export interface CategorySubscription {
  guild_id: string;
  channel_id: string;
  category_id: string;
  category_name: string;
  language: string;
  custom_message?: string | null;
  platform: Platform;
}

export const addCategorySubscription = (
  guildId: string,
  channelId: string,
  categoryId: string,
  categoryName: string,
  language: string,
  customMessage: string | null,
  platform: Platform,
) => {
  db.query(
    `INSERT OR REPLACE INTO category_subscriptions (guild_id, channel_id, category_id, category_name, language, custom_message, platform)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  ).run(
    guildId,
    channelId,
    categoryId,
    categoryName,
    language,
    customMessage,
    platform,
  );
};

export const getAllUniqueCategoryFilters = (
  platform: Platform,
): { category_id: string; language: string }[] => {
  return db
    .query(
      "SELECT DISTINCT category_id, language FROM category_subscriptions WHERE platform = ?1",
    )
    .all(platform) as { category_id: string; language: string }[];
};

export const getGuildsForCategoryFilter = (
  categoryId: string,
  language: string,
  platform: Platform,
): CategorySubscription[] => {
  return db
    .query(
      "SELECT * FROM category_subscriptions WHERE category_id = ?1 AND language = ?2 AND platform = ?3",
    )
    .all(categoryId, language, platform) as CategorySubscription[];
};

// Returns category subscriptions across all platforms for this guild — used
// by /list and autocomplete, which need to display/search everything together.
export const getGuildCategorySubscriptions = (
  guildId: string,
): CategorySubscription[] => {
  return db
    .query("SELECT * FROM category_subscriptions WHERE guild_id = ?1")
    .all(guildId) as CategorySubscription[];
};

export const removeCategorySubscription = (
  guildId: string,
  categoryName: string,
  language: string,
  platform: Platform,
) => {
  db.query(
    "DELETE FROM category_subscriptions WHERE guild_id = ?1 AND category_name = ?2 AND language = ?3 AND platform = ?4",
  ).run(guildId, categoryName, language, platform);
};

export const updateCategorySubscriptionMessage = (
  guildId: string,
  categoryName: string,
  language: string,
  customMessage: string | null,
  platform: Platform,
) => {
  db.query(
    "UPDATE category_subscriptions SET custom_message = ?1 WHERE guild_id = ?2 AND category_name = ?3 AND language = ?4 AND platform = ?5",
  ).run(customMessage, guildId, categoryName, language, platform);
};
