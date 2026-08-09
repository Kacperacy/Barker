import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../migrations/index";

// The repository module imports the singleton `db` from "../connection" at
// module load time, so these tests exercise the same SQL directly against an
// isolated in-memory database rather than importing the module's exports.
function makeTestDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

function saveMatchAndUpdateLastMatch(
  db: Database,
  match: {
    puuid: string;
    match_id: string;
    kills: number;
    deaths: number;
    assists: number;
    win: number;
    duration: number;
    is_remake: number;
    timestamp: number;
    lp_change: number | null;
    raw_json: string;
  } | null,
  lastMatch: {
    puuid: string;
    matchId: string;
    tier: string | null;
    rank: string | null;
    leaguePoints: number | null;
  },
  simulateCrash = false,
) {
  const run = db.transaction(() => {
    if (match) {
      db.query(
        `INSERT OR IGNORE INTO lol_player_matches (puuid, match_id, kills, deaths, assists, win, duration, is_remake, timestamp, lp_change, raw_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      ).run(
        match.puuid,
        match.match_id,
        match.kills,
        match.deaths,
        match.assists,
        match.win,
        match.duration,
        match.is_remake,
        match.timestamp,
        match.lp_change,
        match.raw_json,
      );
    }

    if (simulateCrash) {
      throw new Error("simulated crash mid-write");
    }

    db.query(
      `INSERT OR REPLACE INTO lol_last_matches (puuid, match_id, tier, rank, league_points) VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).run(
      lastMatch.puuid,
      lastMatch.matchId,
      lastMatch.tier,
      lastMatch.rank,
      lastMatch.leaguePoints,
    );
  });

  run();
}

describe("saveMatchAndUpdateLastMatch atomicity", () => {
  test("writes both the match row and the last-match snapshot together", () => {
    const db = makeTestDb();

    saveMatchAndUpdateLastMatch(
      db,
      {
        puuid: "p1",
        match_id: "m1",
        kills: 5,
        deaths: 2,
        assists: 8,
        win: 1,
        duration: 1800,
        is_remake: 0,
        timestamp: 1000,
        lp_change: 15,
        raw_json: "{}",
      },
      { puuid: "p1", matchId: "m1", tier: "GOLD", rank: "I", leaguePoints: 50 },
    );

    const matchRow = db
      .query("SELECT * FROM lol_player_matches WHERE puuid = 'p1'")
      .get() as any;
    const lastMatchRow = db
      .query("SELECT * FROM lol_last_matches WHERE puuid = 'p1'")
      .get() as any;

    expect(matchRow.match_id).toBe("m1");
    expect(lastMatchRow.tier).toBe("GOLD");
  });

  test("a null match (non-ranked skip) still updates the last-match snapshot", () => {
    const db = makeTestDb();

    saveMatchAndUpdateLastMatch(db, null, {
      puuid: "p1",
      matchId: "m1",
      tier: "SILVER",
      rank: "II",
      leaguePoints: 20,
    });

    const matchRow = db
      .query("SELECT * FROM lol_player_matches WHERE puuid = 'p1'")
      .get();
    const lastMatchRow = db
      .query("SELECT * FROM lol_last_matches WHERE puuid = 'p1'")
      .get() as any;

    expect(matchRow).toBeNull();
    expect(lastMatchRow.tier).toBe("SILVER");
  });

  test("a crash mid-transaction rolls back the match row too (no desync)", () => {
    const db = makeTestDb();

    expect(() =>
      saveMatchAndUpdateLastMatch(
        db,
        {
          puuid: "p1",
          match_id: "m1",
          kills: 5,
          deaths: 2,
          assists: 8,
          win: 1,
          duration: 1800,
          is_remake: 0,
          timestamp: 1000,
          lp_change: 15,
          raw_json: "{}",
        },
        { puuid: "p1", matchId: "m1", tier: "GOLD", rank: "I", leaguePoints: 50 },
        true,
      ),
    ).toThrow();

    const matchRow = db
      .query("SELECT * FROM lol_player_matches WHERE puuid = 'p1'")
      .get();
    const lastMatchRow = db
      .query("SELECT * FROM lol_last_matches WHERE puuid = 'p1'")
      .get();

    expect(matchRow).toBeNull();
    expect(lastMatchRow).toBeNull();
  });
});
