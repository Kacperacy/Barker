import type { Migration } from "./types";

const migration: Migration = {
  version: 2,
  name: "lol_player_matches_lp_change",
  up(db) {
    const columns = db
      .query("PRAGMA table_info(lol_player_matches)")
      .all() as { name: string }[];
    const hasLpChangeColumn = columns.some((c) => c.name === "lp_change");

    if (!hasLpChangeColumn) {
      db.query(
        "ALTER TABLE lol_player_matches ADD COLUMN lp_change INTEGER",
      ).run();
    }
  },
};

export default migration;
