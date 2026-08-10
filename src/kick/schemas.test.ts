import { describe, expect, test } from "bun:test";
import {
  kickCategoriesResponseSchema,
  kickChannelsResponseSchema,
  kickCategoryLivestreamsResponseSchema,
  kickTokenResponseSchema,
  kickUserLivestreamsResponseSchema,
} from "./schemas";

describe("kickTokenResponseSchema", () => {
  test("parses a realistic client-credentials token response", () => {
    const fixture = {
      access_token: "abc123",
      token_type: "Bearer",
      expires_in: 3600,
    };
    expect(() => kickTokenResponseSchema.parse(fixture)).not.toThrow();
  });

  test("fails clearly when access_token is missing", () => {
    const result = kickTokenResponseSchema.safeParse({ expires_in: 3600 });
    expect(result.success).toBe(false);
  });
});

describe("kickChannelsResponseSchema", () => {
  test("parses a realistic channels response (documented shape)", () => {
    const fixture = {
      data: [
        {
          broadcaster_user_id: 12345,
          slug: "somestreamer",
          stream_title: "Chill stream",
          channel_description: "welcome",
          banner_picture: "https://example.com/banner.png",
          active_subscribers_count: 10,
          canceled_subscribers_count: 1,
          category: { id: 1, name: "Just Chatting", thumbnail: "x.png" },
          stream: {
            is_live: true,
            viewer_count: 42,
            start_time: "2026-08-09T10:00:00Z",
            language: "en",
            key: "stream-key",
            url: "https://kick.com/somestreamer",
            thumbnail: "thumb.png",
            custom_tags: [],
            is_mature: false,
          },
        },
      ],
      message: "",
    };
    expect(() => kickChannelsResponseSchema.parse(fixture)).not.toThrow();
  });

  test("parses a channel with no active stream (stream field omitted)", () => {
    const fixture = {
      data: [{ broadcaster_user_id: 12345, slug: "somestreamer" }],
    };
    expect(() => kickChannelsResponseSchema.parse(fixture)).not.toThrow();
  });

  test("fails clearly when slug is missing", () => {
    const result = kickChannelsResponseSchema.safeParse({
      data: [{ broadcaster_user_id: 12345 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("kickCategoriesResponseSchema", () => {
  test("parses a realistic categories search response (documented shape)", () => {
    const fixture = {
      data: [
        { id: 1, name: "Just Chatting", tags: ["irl"], thumbnail: "x.png" },
      ],
      message: "",
      pagination: { next_cursor: "abc" },
    };
    expect(() => kickCategoriesResponseSchema.parse(fixture)).not.toThrow();
  });

  test("parses an empty search result", () => {
    expect(() =>
      kickCategoriesResponseSchema.parse({ data: [] }),
    ).not.toThrow();
  });
});

describe("kickUserLivestreamsResponseSchema (batch lookup)", () => {
  test("parses a realistic batch livestream response (documented shape)", () => {
    const fixture = {
      data: [
        {
          id: "01F8MECHZX3TBDSZ7XRADM79XE",
          title: "Chill stream",
          thumbnail: "thumb.png",
          broadcaster_user: {
            id: 12345,
            username: "SomeStreamer",
            profile_picture: "pfp.png",
          },
          category: { id: 1, name: "Just Chatting", thumbnail: "x.png" },
          channel: { slug: "somestreamer" },
          has_mature_content: false,
          language_code: "en",
          started_at: "2026-08-09T10:00:00Z",
          tags: ["irl"],
          viewer_count: 42,
        },
      ],
      message: "",
    };
    expect(() =>
      kickUserLivestreamsResponseSchema.parse(fixture),
    ).not.toThrow();
  });

  test("parses an empty result (nobody in the batch is live)", () => {
    expect(() =>
      kickUserLivestreamsResponseSchema.parse({ data: [] }),
    ).not.toThrow();
  });

  test("fails clearly when viewer_count is the wrong type", () => {
    const broken = {
      data: [
        {
          id: "x",
          title: "t",
          broadcaster_user: { id: 1, username: "a" },
          category: { id: 1, name: "c" },
          channel: { slug: "a" },
          language_code: "en",
          started_at: "2026-08-09T10:00:00Z",
          viewer_count: "42",
        },
      ],
    };
    const result = kickUserLivestreamsResponseSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });
});

describe("kickCategoryLivestreamsResponseSchema (category discovery)", () => {
  test("parses a realistic paginated category-livestreams response", () => {
    const fixture = {
      data: [
        {
          id: "01F8MECHZX3TBDSZ7XRADM79XE",
          title: "Chill stream",
          broadcaster_user: { id: 12345, username: "SomeStreamer" },
          category: { id: 1, name: "Just Chatting" },
          channel: { slug: "somestreamer" },
          viewer_count: 42,
          language_code: "en",
          started_at: "2026-08-09T10:00:00Z",
          tags: [],
          has_mature_content: false,
        },
      ],
      pagination: { next_cursor: "abc123" },
    };
    expect(() =>
      kickCategoryLivestreamsResponseSchema.parse(fixture),
    ).not.toThrow();
  });

  test("parses a response with a null next_cursor (last page)", () => {
    const fixture = {
      data: [],
      pagination: { next_cursor: null },
    };
    expect(() =>
      kickCategoryLivestreamsResponseSchema.parse(fixture),
    ).not.toThrow();
  });
});
