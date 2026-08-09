import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../migrations/index";

// The repository module imports the singleton `db` from "../connection" at
// load time, so — as with the Stage 5 transaction tests — these exercise the
// same SQL directly against an isolated in-memory database.
function makeTestDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

const NO_CATEGORY = "";

function saveLiveAnnouncement(
  db: Database,
  guildId: string,
  channelId: string,
  streamerLogin: string,
  categoryId: string | null,
  streamerName: string | null,
  messageId: string,
) {
  db.query(
    `INSERT OR REPLACE INTO live_announcements (guild_id, channel_id, streamer_login, category_id, streamer_name, message_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).run(
    guildId,
    channelId,
    streamerLogin,
    categoryId ?? NO_CATEGORY,
    streamerName,
    messageId,
  );
}

function getLiveAnnouncement(
  db: Database,
  guildId: string,
  channelId: string,
  streamerLogin: string,
  categoryId: string | null,
) {
  return db
    .query(
      "SELECT * FROM live_announcements WHERE guild_id = ?1 AND channel_id = ?2 AND streamer_login = ?3 AND category_id = ?4",
    )
    .get(guildId, channelId, streamerLogin, categoryId ?? NO_CATEGORY);
}

describe("live_announcements schema", () => {
  test("re-saving the same (guild, channel, streamer, category) upserts rather than duplicates", () => {
    const db = makeTestDb();

    saveLiveAnnouncement(db, "g1", "c1", "streamer1", null, "Streamer1", "m1");
    saveLiveAnnouncement(db, "g1", "c1", "streamer1", null, "Streamer1", "m2");

    const rows = db
      .query(
        "SELECT * FROM live_announcements WHERE guild_id = 'g1' AND channel_id = 'c1' AND streamer_login = 'streamer1'",
      )
      .all() as any[];

    expect(rows.length).toBe(1);
    expect(rows[0].message_id).toBe("m2");
  });

  test("individual (no-category) and category-scoped announcements for the same streamer+channel coexist independently", () => {
    const db = makeTestDb();

    saveLiveAnnouncement(
      db,
      "g1",
      "c1",
      "streamer1",
      null,
      "Streamer1",
      "individual-msg",
    );
    saveLiveAnnouncement(
      db,
      "g1",
      "c1",
      "streamer1",
      "cat123",
      "Streamer1",
      "category-msg",
    );

    const individual = getLiveAnnouncement(
      db,
      "g1",
      "c1",
      "streamer1",
      null,
    ) as any;
    const categoryScoped = getLiveAnnouncement(
      db,
      "g1",
      "c1",
      "streamer1",
      "cat123",
    ) as any;

    expect(individual.message_id).toBe("individual-msg");
    expect(categoryScoped.message_id).toBe("category-msg");
  });

  test("the same streamer announced to multiple guilds/channels gets independent rows", () => {
    const db = makeTestDb();

    saveLiveAnnouncement(db, "g1", "c1", "streamer1", "cat1", "S1", "m1");
    saveLiveAnnouncement(db, "g2", "c2", "streamer1", "cat1", "S1", "m2");

    const rows = db
      .query(
        "SELECT * FROM live_announcements WHERE streamer_login = 'streamer1' AND category_id = 'cat1'",
      )
      .all() as any[];

    expect(rows.length).toBe(2);
  });

  test("DISTINCT streamer_login lookup for a category reflects all guilds currently tracking it, once each", () => {
    const db = makeTestDb();

    saveLiveAnnouncement(db, "g1", "c1", "streamer1", "cat1", "S1", "m1");
    saveLiveAnnouncement(db, "g2", "c2", "streamer1", "cat1", "S1", "m2");
    saveLiveAnnouncement(db, "g1", "c1", "streamer2", "cat1", "S2", "m3");

    const logins = (
      db
        .query(
          "SELECT DISTINCT streamer_login FROM live_announcements WHERE category_id = 'cat1'",
        )
        .all() as { streamer_login: string }[]
    )
      .map((r) => r.streamer_login)
      .sort();

    expect(logins).toEqual(["streamer1", "streamer2"]);
  });

  test("clearing announcements for a streamer only removes that category scope", () => {
    const db = makeTestDb();

    saveLiveAnnouncement(db, "g1", "c1", "streamer1", null, "S1", "m1");
    saveLiveAnnouncement(db, "g1", "c1", "streamer1", "cat1", "S1", "m2");

    db.query(
      "DELETE FROM live_announcements WHERE streamer_login = 'streamer1' AND category_id = ?1",
    ).run(NO_CATEGORY);

    expect(getLiveAnnouncement(db, "g1", "c1", "streamer1", null)).toBeNull();
    expect(
      getLiveAnnouncement(db, "g1", "c1", "streamer1", "cat1"),
    ).not.toBeNull();
  });
});

describe("category_streamer_strikes schema", () => {
  function incrementStrikes(
    db: Database,
    categoryId: string,
    streamerLogin: string,
  ): number {
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
  }

  test("increments from 1 and accumulates across calls", () => {
    const db = makeTestDb();

    expect(incrementStrikes(db, "cat1", "streamer1")).toBe(1);
    expect(incrementStrikes(db, "cat1", "streamer1")).toBe(2);
    expect(incrementStrikes(db, "cat1", "streamer1")).toBe(3);
  });

  test("strikes are independent per (category, streamer) pair", () => {
    const db = makeTestDb();

    incrementStrikes(db, "cat1", "streamer1");
    incrementStrikes(db, "cat1", "streamer1");
    incrementStrikes(db, "cat2", "streamer1");

    const cat1Strikes = db
      .query(
        "SELECT missing_strikes FROM category_streamer_strikes WHERE category_id = 'cat1' AND streamer_login = 'streamer1'",
      )
      .get() as any;
    const cat2Strikes = db
      .query(
        "SELECT missing_strikes FROM category_streamer_strikes WHERE category_id = 'cat2' AND streamer_login = 'streamer1'",
      )
      .get() as any;

    expect(cat1Strikes.missing_strikes).toBe(2);
    expect(cat2Strikes.missing_strikes).toBe(1);
  });

  test("clearing strikes removes the row entirely", () => {
    const db = makeTestDb();
    incrementStrikes(db, "cat1", "streamer1");

    db.query(
      "DELETE FROM category_streamer_strikes WHERE category_id = 'cat1' AND streamer_login = 'streamer1'",
    ).run();

    const row = db
      .query(
        "SELECT * FROM category_streamer_strikes WHERE category_id = 'cat1' AND streamer_login = 'streamer1'",
      )
      .get();
    expect(row).toBeNull();
  });
});
