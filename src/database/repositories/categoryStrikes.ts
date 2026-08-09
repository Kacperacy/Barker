import { db } from "../connection";

export const incrementStrikes = (
  categoryId: string,
  streamerLogin: string,
): number => {
  db.query(
    `INSERT INTO category_streamer_strikes (category_id, streamer_login, missing_strikes)
     VALUES (?1, ?2, 1)
     ON CONFLICT(category_id, streamer_login)
     DO UPDATE SET missing_strikes = missing_strikes + 1`,
  ).run(categoryId, streamerLogin);

  const res = db
    .query(
      "SELECT missing_strikes FROM category_streamer_strikes WHERE category_id = ?1 AND streamer_login = ?2",
    )
    .get(categoryId, streamerLogin) as { missing_strikes: number };
  return res.missing_strikes;
};

export const clearStrikes = (categoryId: string, streamerLogin: string) => {
  db.query(
    "DELETE FROM category_streamer_strikes WHERE category_id = ?1 AND streamer_login = ?2",
  ).run(categoryId, streamerLogin);
};
