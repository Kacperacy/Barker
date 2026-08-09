import { describe, expect, test } from "bun:test";
import {
  eventSubSubscriptionsResponseSchema,
  twitchGamesResponseSchema,
  twitchStreamsResponseSchema,
  twitchUsersResponseSchema,
} from "./schemas";

describe("twitchUsersResponseSchema", () => {
  test("parses a realistic users response", () => {
    const fixture = {
      data: [
        {
          id: "141981764",
          login: "twitchdev",
          display_name: "TwitchDev",
          type: "",
          broadcaster_type: "partner",
        },
      ],
    };
    expect(() => twitchUsersResponseSchema.parse(fixture)).not.toThrow();
  });

  test("parses an empty result (user not found)", () => {
    expect(() =>
      twitchUsersResponseSchema.parse({ data: [] }),
    ).not.toThrow();
  });
});

describe("twitchStreamsResponseSchema", () => {
  const streamFixture = {
    id: "40952121085",
    user_id: "12345",
    user_login: "somestreamer",
    user_name: "SomeStreamer",
    game_id: "509658",
    game_name: "Just Chatting",
    type: "live",
    title: "Chill stream",
    viewer_count: 123,
    started_at: "2026-08-09T10:00:00Z",
    language: "en",
    thumbnail_url:
      "https://static-cdn.jtvnw.net/previews-ttv/live_user_x-{width}x{height}.jpg",
    tag_ids: [],
    is_mature: false,
  };

  test("parses a realistic streams response with pagination", () => {
    const fixture = {
      data: [streamFixture],
      pagination: { cursor: "abc123" },
    };
    expect(() => twitchStreamsResponseSchema.parse(fixture)).not.toThrow();
  });

  test("parses a response with no cursor (last page)", () => {
    const fixture = { data: [streamFixture], pagination: {} };
    expect(() => twitchStreamsResponseSchema.parse(fixture)).not.toThrow();
  });

  test("fails clearly when viewer_count is the wrong type", () => {
    const broken = {
      data: [{ ...streamFixture, viewer_count: "123" }],
    };
    const result = twitchStreamsResponseSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });
});

describe("twitchGamesResponseSchema", () => {
  test("parses a realistic games response", () => {
    const fixture = {
      data: [
        {
          id: "509658",
          name: "Just Chatting",
          box_art_url: "https://static-cdn.jtvnw.net/box-art.jpg",
        },
      ],
    };
    expect(() => twitchGamesResponseSchema.parse(fixture)).not.toThrow();
  });
});

describe("eventSubSubscriptionsResponseSchema", () => {
  test("parses a realistic eventsub subscriptions list", () => {
    const fixture = {
      data: [
        {
          id: "sub-1",
          status: "enabled",
          type: "stream.online",
          condition: { broadcaster_user_id: "12345" },
        },
      ],
      total: 1,
    };
    expect(() =>
      eventSubSubscriptionsResponseSchema.parse(fixture),
    ).not.toThrow();
  });

  test("fails clearly when condition is missing broadcaster_user_id", () => {
    const broken = {
      data: [{ id: "sub-1", type: "stream.online", condition: {} }],
    };
    const result = eventSubSubscriptionsResponseSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });
});
