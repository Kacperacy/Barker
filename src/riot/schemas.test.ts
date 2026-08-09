import { describe, expect, test } from "bun:test";
import {
  accountDtoSchema,
  leagueEntriesSchema,
  matchDtoSchema,
  matchIdsSchema,
} from "./schemas";

describe("accountDtoSchema", () => {
  test("parses a realistic account response", () => {
    const fixture = {
      puuid: "abc123-puuid",
      gameName: "SomePlayer",
      tagLine: "EUNE",
    };
    expect(() => accountDtoSchema.parse(fixture)).not.toThrow();
  });

  test("fails clearly when puuid is missing", () => {
    const fixture = { gameName: "SomePlayer", tagLine: "EUNE" };
    const result = accountDtoSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });
});

describe("matchIdsSchema", () => {
  test("parses an array of match ids", () => {
    expect(() =>
      matchIdsSchema.parse(["EUN1_123456789", "EUN1_987654321"]),
    ).not.toThrow();
  });

  test("parses an empty array (no matches yet)", () => {
    expect(() => matchIdsSchema.parse([])).not.toThrow();
  });
});

describe("matchDtoSchema", () => {
  const participantFixture = {
    puuid: "abc123-puuid",
    kills: 5,
    deaths: 3,
    assists: 7,
    win: true,
    championId: 157,
    championName: "Yasuo",
    teamPosition: "MIDDLE",
    visionScore: 22,
    totalMinionsKilled: 180,
    neutralMinionsKilled: 10,
    gameEndedInEarlySurrender: false,
    // Riot's real payload has dozens more fields we don't consume.
    perks: { statPerks: {}, styles: [] },
    item0: 3006,
  };

  const matchFixture = {
    metadata: {
      matchId: "EUN1_123456789",
      dataVersion: "2",
      participants: ["abc123-puuid"],
    },
    info: {
      queueId: 420,
      platformId: "EUN1",
      gameDuration: 1834,
      gameCreation: 1710000000000,
      gameMode: "CLASSIC",
      participants: [participantFixture],
    },
  };

  test("parses a realistic full match payload", () => {
    expect(() => matchDtoSchema.parse(matchFixture)).not.toThrow();
  });

  test("preserves unrecognized fields (passthrough) for raw_json fidelity", () => {
    const parsed = matchDtoSchema.parse(matchFixture);
    expect(parsed.info.gameMode).toBe("CLASSIC");
    expect(parsed.metadata.dataVersion).toBe("2");
    expect((parsed.info.participants[0] as any).item0).toBe(3006);
  });

  test("fails clearly when a required field is missing (e.g. gameDuration)", () => {
    const broken = {
      metadata: matchFixture.metadata,
      info: { ...matchFixture.info, gameDuration: undefined },
    };
    const result = matchDtoSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  test("gameEndedInEarlySurrender is optional (older matches may omit it)", () => {
    const { gameEndedInEarlySurrender, ...rest } = participantFixture;
    const withoutFlag = {
      ...matchFixture,
      info: { ...matchFixture.info, participants: [rest] },
    };
    expect(() => matchDtoSchema.parse(withoutFlag)).not.toThrow();
  });
});

describe("leagueEntriesSchema", () => {
  test("parses a realistic ranked entries response", () => {
    const fixture = [
      {
        leagueId: "abc-def",
        queueType: "RANKED_SOLO_5x5",
        tier: "GOLD",
        rank: "I",
        leaguePoints: 42,
        wins: 100,
        losses: 90,
      },
    ];
    expect(() => leagueEntriesSchema.parse(fixture)).not.toThrow();
  });

  test("parses an empty array (unranked player)", () => {
    expect(() => leagueEntriesSchema.parse([])).not.toThrow();
  });

  test("fails clearly when leaguePoints is the wrong type", () => {
    const broken = [
      {
        queueType: "RANKED_SOLO_5x5",
        tier: "GOLD",
        rank: "I",
        leaguePoints: "42",
      },
    ];
    const result = leagueEntriesSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });
});
