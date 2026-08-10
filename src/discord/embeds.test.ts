import { describe, expect, test } from "bun:test";
import {
  buildKickLiveEmbed,
  buildKickOfflineEmbed,
  buildLiveEmbed,
  buildLoLLiveEmbed,
  buildOfflineEmbed,
  formatNotificationText,
} from "./embeds";

describe("buildLiveEmbed", () => {
  const stream = {
    title: "Chill stream",
    user_login: "somestreamer",
    user_name: "SomeStreamer",
    game_name: "Just Chatting",
    language: "en",
    viewer_count: 123,
    thumbnail_url:
      "https://static-cdn.jtvnw.net/previews-ttv/live_user_x-{width}x{height}.jpg",
  };

  test("builds the expected fields from a stream payload", () => {
    const embed = buildLiveEmbed(stream).toJSON();

    expect(embed.title).toBe("Chill stream");
    expect(embed.url).toBe("https://twitch.tv/somestreamer");
    expect(embed.author?.name).toBe(
      "SomeStreamer is live in Just Chatting!",
    );
    expect(embed.fields).toEqual([
      { name: "Language", value: "EN", inline: true },
      { name: "Viewers", value: "123", inline: true },
    ]);
    expect(embed.image?.url).toBe(
      "https://static-cdn.jtvnw.net/previews-ttv/live_user_x-1280x720.jpg",
    );
  });

  test("falls back to 'a category' when game_name is missing", () => {
    const embed = buildLiveEmbed({ ...stream, game_name: "" }).toJSON();
    expect(embed.author?.name).toBe("SomeStreamer is live in a category!");
  });

  test("shows N/A when language is missing", () => {
    const embed = buildLiveEmbed({ ...stream, language: "" }).toJSON();
    expect(embed.fields?.[0]?.value).toBe("N/A");
  });
});

describe("buildOfflineEmbed", () => {
  test("builds the expected offline embed", () => {
    const embed = buildOfflineEmbed("SomeStreamer", "somestreamer").toJSON();
    expect(embed.title).toBe("Stream has ended");
    expect(embed.author?.name).toBe("SomeStreamer was live");
    expect(embed.url).toBe("https://twitch.tv/somestreamer");
  });
});

describe("buildKickLiveEmbed", () => {
  const stream = {
    title: "Chill stream",
    channel: { slug: "somestreamer" },
    broadcaster_user: { id: 1, username: "SomeStreamer" },
    category: { id: 1, name: "Just Chatting" },
    language_code: "en",
    viewer_count: 123,
    thumbnail: "https://example.com/thumb.png",
  };

  test("builds the expected fields from a livestream payload", () => {
    const embed = buildKickLiveEmbed(stream).toJSON();

    expect(embed.title).toBe("Chill stream");
    expect(embed.url).toBe("https://kick.com/somestreamer");
    expect(embed.author?.name).toBe(
      "SomeStreamer is live in Just Chatting!",
    );
    expect(embed.color).toBe(0x53fc18);
    expect(embed.fields).toEqual([
      { name: "Language", value: "EN", inline: true },
      { name: "Viewers", value: "123", inline: true },
    ]);
    expect(embed.image?.url).toBe("https://example.com/thumb.png");
  });

  test("falls back to 'a category' when category is missing", () => {
    const embed = buildKickLiveEmbed({
      ...stream,
      category: undefined,
    }).toJSON();
    expect(embed.author?.name).toBe("SomeStreamer is live in a category!");
  });

  test("shows N/A when language_code is missing", () => {
    const embed = buildKickLiveEmbed({
      ...stream,
      language_code: "",
    }).toJSON();
    expect(embed.fields?.[0]?.value).toBe("N/A");
  });
});

describe("buildKickOfflineEmbed", () => {
  test("builds the expected offline embed", () => {
    const embed = buildKickOfflineEmbed(
      "SomeStreamer",
      "somestreamer",
    ).toJSON();
    expect(embed.title).toBe("Stream has ended");
    expect(embed.author?.name).toBe("SomeStreamer was live");
    expect(embed.url).toBe("https://kick.com/somestreamer");
  });
});

describe("buildLoLLiveEmbed", () => {
  const baseParticipant = {
    puuid: "p1",
    kills: 5,
    deaths: 2,
    assists: 8,
    win: true,
    championId: 157,
    championName: "Yasuo",
    teamPosition: "MIDDLE",
    visionScore: 22,
    totalMinionsKilled: 180,
    neutralMinionsKilled: 10,
    gameEndedInEarlySurrender: false,
  };

  const baseMatchData = {
    metadata: { matchId: "EUN1_123456789" },
    info: {
      gameDuration: 1834,
      participants: [baseParticipant],
    },
  };

  test("marks a win as Victory with green color", () => {
    const embed = buildLoLLiveEmbed(
      baseMatchData,
      "p1",
      "Player#EUNE",
      "eune",
      "Gold I - 50 LP",
      " (+15)",
      "3W",
    ).toJSON();

    expect(embed.title).toBe("Victory with Yasuo");
    expect(embed.color).toBe(0x00ff00);
    expect(embed.fields).toContainEqual({
      name: "Current Rank",
      value: "Gold I - 50 LP (+15)",
      inline: true,
    });
    expect(embed.fields).toContainEqual({
      name: "Current Streak",
      value: "3W",
      inline: true,
    });
  });

  test("marks a loss as Defeat with red color", () => {
    const lossMatch = {
      ...baseMatchData,
      info: {
        ...baseMatchData.info,
        participants: [{ ...baseParticipant, win: false }],
      },
    };
    const embed = buildLoLLiveEmbed(
      lossMatch,
      "p1",
      "Player#EUNE",
      "eune",
      "",
      "",
      "None",
    ).toJSON();

    expect(embed.title).toBe("Defeat with Yasuo");
    expect(embed.color).toBe(0xff0000);
    expect(embed.fields).toContainEqual({
      name: "Current Rank",
      value: "Unranked",
      inline: true,
    });
  });

  test("marks a remake as gray regardless of win/loss", () => {
    const remakeMatch = {
      ...baseMatchData,
      info: {
        ...baseMatchData.info,
        gameDuration: 120,
        participants: [{ ...baseParticipant, win: true }],
      },
    };
    const embed = buildLoLLiveEmbed(
      remakeMatch,
      "p1",
      "Player#EUNE",
      "eune",
      "",
      "",
      "None",
    ).toJSON();

    expect(embed.title).toBe("Remake with Yasuo");
    expect(embed.color).toBe(0x808080);
  });

  test("formats KDA and duration correctly", () => {
    const embed = buildLoLLiveEmbed(
      baseMatchData,
      "p1",
      "Player#EUNE",
      "eune",
      "",
      "",
      "None",
    ).toJSON();

    expect(embed.fields).toContainEqual({
      name: "KDA",
      value: "5/2/8",
      inline: true,
    });
    expect(embed.fields).toContainEqual({
      name: "Duration",
      value: "30m 34s",
      inline: true,
    });
  });
});

describe("formatNotificationText", () => {
  test("substitutes {streamer} and {game} placeholders", () => {
    const result = formatNotificationText(
      "{streamer} is playing {game}!",
      "SomeStreamer",
      "Just Chatting",
    );
    expect(result).toBe("SomeStreamer is playing Just Chatting!");
  });

  test("is case-insensitive on placeholders", () => {
    const result = formatNotificationText(
      "{STREAMER} is playing {Game}!",
      "SomeStreamer",
      "Just Chatting",
    );
    expect(result).toBe("SomeStreamer is playing Just Chatting!");
  });

  test("falls back to 'a category' when game name is empty", () => {
    const result = formatNotificationText(
      "{streamer} is playing {game}!",
      "SomeStreamer",
      "",
    );
    expect(result).toBe("SomeStreamer is playing a category!");
  });
});
