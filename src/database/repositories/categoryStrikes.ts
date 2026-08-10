import { db } from "../connection";
import type { Platform } from "../../types";

export const incrementStrikes = (
  categoryId: string,
  streamerLogin: string,
  platform: Platform,
): number => {
  db.query(
    `INSERT INTO category_streamer_strikes (category_id, streamer_login, missing_strikes, platform)
     VALUES (?1, ?2, 1, ?3)
     ON CONFLICT(category_id, streamer_login, platform)
     DO UPDATE SET missing_strikes = missing_strikes + 1`,
  ).run(categoryId, streamerLogin, platform);

  const res = db
    .query(
      "SELECT missing_strikes FROM category_streamer_strikes WHERE category_id = ?1 AND streamer_login = ?2 AND platform = ?3",
    )
    .get(categoryId, streamerLogin, platform) as { missing_strikes: number };
  return res.missing_strikes;
};

export const clearStrikes = (
  categoryId: string,
  streamerLogin: string,
  platform: Platform,
) => {
  db.query(
    "DELETE FROM category_streamer_strikes WHERE category_id = ?1 AND streamer_login = ?2 AND platform = ?3",
  ).run(categoryId, streamerLogin, platform);
};
