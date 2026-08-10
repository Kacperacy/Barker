import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "./index";
import migration0001 from "./0001_initial";
import migration0002 from "./0002_lol_player_matches_lp_change";
import migration0003 from "./0003_unify_live_tracking";

function tableNames(db: Database): string[] {
  return (
    db
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[]
  )
    .map((row) => row.name)
    .sort();
}

describe("runMigrations", () => {
  test("creates all expected tables on a fresh database", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    expect(tableNames(db)).toEqual(
      [
        "blacklisted_streamers",
        "category_streamer_strikes",
        "category_subscriptions",
        "config",
        "live_announcements",
        "lol_last_matches",
        "lol_player_matches",
        "lol_subscriptions",
        "schema_migrations",
        "subscriptions",
      ].sort(),
    );
  });

  test("is idempotent — running twice does not error or duplicate migrations", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();

    const applied = db
      .query("SELECT version FROM schema_migrations ORDER BY version")
      .all() as { version: number }[];
    expect(applied.map((r) => r.version)).toEqual([1, 2, 3, 4]);
  });

  test("migration 0002 adds lp_change to lol_player_matches", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const columns = db
      .query("PRAGMA table_info(lol_player_matches)")
      .all() as { name: string }[];
    expect(columns.some((c) => c.name === "lp_change")).toBe(true);
  });

  test("migration 0003 drops the superseded active_messages/category_notified tables, even with existing rows", () => {
    const db = new Database(":memory:");
    // Simulate a database that already went through migration 1 in
    // production (real schema, via the actual migration), with real rows in
    // the tables migration 3 retires.
    migration0001.up(db);
    db.query(
      "INSERT INTO active_messages VALUES ('somestreamer', 'chan1', 'msg1')",
    ).run();
    db.query("INSERT INTO category_notified VALUES ('user1', 'cat1')").run();
    db.query(
      `CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
    ).run();
    db.query(
      "INSERT INTO schema_migrations (version, applied_at) VALUES (1, '2020-01-01')",
    ).run();

    expect(() => runMigrations(db)).not.toThrow();

    expect(tableNames(db)).not.toContain("active_messages");
    expect(tableNames(db)).not.toContain("category_notified");
    expect(tableNames(db)).toContain("live_announcements");
    expect(tableNames(db)).toContain("category_streamer_strikes");
  });

  test("migration 0004 adds platform to all five tables, preserving existing rows as 'twitch'", () => {
    const db = new Database(":memory:");
    // Simulate a database that already went through migrations 1-3 in
    // production (real schema, via the actual migrations), with real rows
    // in every table migration 4 touches.
    migration0001.up(db);
    migration0002.up(db);
    migration0003.up(db);
    db.query(
      `CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
    ).run();
    for (const version of [1, 2, 3]) {
      db.query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, '2020-01-01')",
      ).run(version);
    }

    db.query(
      "INSERT INTO subscriptions VALUES ('g1', 'c1', 'streamer1', NULL)",
    ).run();
    db.query(
      "INSERT INTO category_subscriptions VALUES ('g1', 'c1', 'cat1', 'Category One', 'en', NULL)",
    ).run();
    db.query("INSERT INTO blacklisted_streamers VALUES ('g1', 'baduser')").run();
    db.query(
      "INSERT INTO live_announcements VALUES ('g1', 'c1', 'streamer1', '', 'Streamer One', 'msg1')",
    ).run();
    db.query(
      "INSERT INTO category_streamer_strikes VALUES ('cat1', 'streamer1', 2)",
    ).run();

    expect(() => runMigrations(db)).not.toThrow();

    expect(
      db.query("SELECT * FROM subscriptions").get() as any,
    ).toMatchObject({ streamer_name: "streamer1", platform: "twitch" });
    expect(
      db.query("SELECT * FROM category_subscriptions").get() as any,
    ).toMatchObject({ category_id: "cat1", platform: "twitch" });
    expect(
      db.query("SELECT * FROM blacklisted_streamers").get() as any,
    ).toMatchObject({ streamer_name: "baduser", platform: "twitch" });
    expect(
      db.query("SELECT * FROM live_announcements").get() as any,
    ).toMatchObject({ streamer_login: "streamer1", platform: "twitch" });
    expect(
      db.query("SELECT * FROM category_streamer_strikes").get() as any,
    ).toMatchObject({ missing_strikes: 2, platform: "twitch" });

    // A same-key row on the other platform must now be insertable —
    // proving the PRIMARY KEY actually widened to include `platform`.
    expect(() =>
      db
        .query(
          "INSERT INTO subscriptions VALUES ('g1', 'c1', 'streamer1', NULL, 'kick')",
        )
        .run(),
    ).not.toThrow();

    const subCount = (
      db.query("SELECT COUNT(*) as count FROM subscriptions").get() as {
        count: number;
      }
    ).count;
    expect(subCount).toBe(2);

    const applied = db
      .query("SELECT version FROM schema_migrations ORDER BY version")
      .all() as { version: number }[];
    expect(applied.map((r) => r.version)).toEqual([1, 2, 3, 4]);
  });

  test("a partially-migrated database (only migration 1 recorded) only applies migration 2", () => {
    const db = new Database(":memory:");
    // Simulate a database that already has the initial schema but predates
    // the lp_change migration being tracked.
    runMigrations(db);
    db.query("DELETE FROM schema_migrations WHERE version = 2").run();
    db.query("ALTER TABLE lol_player_matches DROP COLUMN lp_change").run();

    runMigrations(db);

    const columns = db
      .query("PRAGMA table_info(lol_player_matches)")
      .all() as { name: string }[];
    expect(columns.some((c) => c.name === "lp_change")).toBe(true);
  });
});
