import { db } from "../connection";

export interface CategorySubscription {
  guild_id: string;
  channel_id: string;
  category_id: string;
  category_name: string;
  language: string;
  custom_message?: string | null;
}

export const addCategorySubscription = (
  guildId: string,
  channelId: string,
  categoryId: string,
  categoryName: string,
  language: string,
  customMessage: string | null = null,
) => {
  db.query(
    `INSERT OR REPLACE INTO category_subscriptions (guild_id, channel_id, category_id, category_name, language, custom_message) 
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).run(guildId, channelId, categoryId, categoryName, language, customMessage);
};

export const getAllUniqueCategoryFilters = (): {
  category_id: string;
  language: string;
}[] => {
  return db
    .query("SELECT DISTINCT category_id, language FROM category_subscriptions")
    .all() as { category_id: string; language: string }[];
};

export const getGuildsForCategoryFilter = (
  categoryId: string,
  language: string,
): CategorySubscription[] => {
  return db
    .query(
      "SELECT * FROM category_subscriptions WHERE category_id = ?1 AND language = ?2",
    )
    .all(categoryId, language) as CategorySubscription[];
};

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
) => {
  db.query(
    "DELETE FROM category_subscriptions WHERE guild_id = ?1 AND category_name = ?2 AND language = ?3",
  ).run(guildId, categoryName, language);
};

export const updateCategorySubscriptionMessage = (
  guildId: string,
  categoryName: string,
  language: string,
  customMessage: string | null,
) => {
  db.query(
    "UPDATE category_subscriptions SET custom_message = ?1 WHERE guild_id = ?2 AND category_name = ?3 AND language = ?4",
  ).run(customMessage, guildId, categoryName, language);
};
