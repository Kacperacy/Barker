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

export const addNotifiedUser = (userId: string, categoryId: string) => {
  db.query(
    `INSERT OR IGNORE INTO category_notified (user_id, category_id) VALUES (?1, ?2)`,
  ).run(userId, categoryId);
};

export const isUserNotified = (userId: string, categoryId: string): boolean => {
  const res = db
    .query(
      "SELECT 1 FROM category_notified WHERE user_id = ?1 AND category_id = ?2",
    )
    .get(userId, categoryId);
  return !!res;
};

export const getNotifiedUsersForCategory = (
  categoryId: string,
): { user_id: string }[] => {
  return db
    .query("SELECT user_id FROM category_notified WHERE category_id = ?1")
    .all(categoryId) as { user_id: string }[];
};

export const removeNotifiedUser = (userId: string, categoryId: string) => {
  db.query(
    "DELETE FROM category_notified WHERE user_id = ?1 AND category_id = ?2",
  ).run(userId, categoryId);
};
