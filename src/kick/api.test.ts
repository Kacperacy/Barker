import { afterEach, describe, expect, mock, test } from "bun:test";
import { env } from "../config";

mock.module("./auth", () => ({
  getValidAppToken: async () => "test-app-token",
}));

const {
  getKickBroadcasterId,
  getKickCategoryId,
  getKickLivestreamsByBroadcasterIds,
  getKickStreamsByCategory,
} = await import("./api");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

interface ResponseSpec {
  status: number;
  body: unknown;
}

function jsonResponse(status: number, body: unknown): ResponseSpec {
  return { status, body };
}

// Builds a fresh Response per call (never reuses/re-reads a body), since
// fetchWithRetry may call fetch multiple times for a single logical request
// (e.g. retrying a 5xx) — reusing one Response instance across those calls
// would throw "Body already used" on the second read.
function mockFetchSequence(specs: ResponseSpec[]) {
  let call = 0;
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    const spec = specs[call] ?? specs[specs.length - 1]!;
    call++;
    return new Response(JSON.stringify(spec.body), { status: spec.status });
  }) as unknown as typeof fetch;
  return urls;
}

describe("getKickBroadcasterId", () => {
  test("returns the broadcaster id on a successful lookup", async () => {
    mockFetchSequence([
      jsonResponse(200, {
        data: [{ broadcaster_user_id: 12345, slug: "somestreamer" }],
      }),
    ]);

    const id = await getKickBroadcasterId("SomeStreamer");
    expect(id).toBe("12345");
  });

  test("returns null and logs on a 404", async () => {
    mockFetchSequence([jsonResponse(404, { message: "not found" })]);

    const id = await getKickBroadcasterId("doesnotexist");
    expect(id).toBeNull();
  });

  test("returns null on an empty data array (slug not found)", async () => {
    mockFetchSequence([jsonResponse(200, { data: [] })]);

    const id = await getKickBroadcasterId("nosuchuser");
    expect(id).toBeNull();
  });

  test("returns null on a malformed response shape", async () => {
    mockFetchSequence([jsonResponse(200, { data: [{ slug: "onlyslug" }] })]);

    const id = await getKickBroadcasterId("someuser");
    expect(id).toBeNull();
  });

  test("caches the result — a second lookup for the same slug does not refetch", async () => {
    const urls = mockFetchSequence([
      jsonResponse(200, {
        data: [{ broadcaster_user_id: 999, slug: "cacheduser" }],
      }),
    ]);

    await getKickBroadcasterId("cacheduser");
    await getKickBroadcasterId("cacheduser");

    expect(urls.length).toBe(1);
  });
});

describe("getKickCategoryId", () => {
  test("returns the category id and name on a successful search", async () => {
    mockFetchSequence([
      jsonResponse(200, { data: [{ id: 1, name: "Just Chatting" }] }),
    ]);

    const category = await getKickCategoryId("Just Chatting");
    expect(category).toEqual({ id: "1", name: "Just Chatting" });
  });

  test("returns null when no category matches", async () => {
    mockFetchSequence([jsonResponse(200, { data: [] })]);

    const category = await getKickCategoryId("NoSuchCategory");
    expect(category).toBeNull();
  });
});

describe("getKickLivestreamsByBroadcasterIds", () => {
  function livestreamFixture(id: number, username: string) {
    return {
      id: `stream-${id}`,
      title: "t",
      broadcaster_user: { id, username },
      category: { id: 1, name: "Just Chatting" },
      channel: { slug: username },
      viewer_count: 10,
      language_code: "en",
      started_at: "2026-08-09T10:00:00Z",
    };
  }

  test("returns an empty array without fetching when given no ids", async () => {
    const urls = mockFetchSequence([jsonResponse(200, { data: [] })]);

    const result = await getKickLivestreamsByBroadcasterIds([]);
    expect(result).toEqual([]);
    expect(urls.length).toBe(0);
  });

  test("returns live streams from a single-chunk batch", async () => {
    mockFetchSequence([
      jsonResponse(200, {
        data: [livestreamFixture(1, "a"), livestreamFixture(2, "b")],
      }),
    ]);

    const result = await getKickLivestreamsByBroadcasterIds(["1", "2"]);
    expect(result.length).toBe(2);
  });

  test("chunks into multiple requests when given more than 100 ids", async () => {
    const urls = mockFetchSequence([
      jsonResponse(200, { data: [livestreamFixture(1, "a")] }),
      jsonResponse(200, { data: [livestreamFixture(2, "b")] }),
    ]);

    const ids = Array.from({ length: 150 }, (_, i) => String(i + 1));
    const result = await getKickLivestreamsByBroadcasterIds(ids);

    expect(urls.length).toBe(2);
    expect(result.length).toBe(2);
  });

  test("skips a failed chunk but still returns results from successful ones", async () => {
    // fetchWithRetry retries a 5xx up to HTTP_RETRY_MAX_ATTEMPTS times before
    // giving up, so the first chunk needs that many failing responses before
    // the second chunk's success response is reached in the mock sequence.
    const failuresForFirstChunk = Array.from(
      { length: env.HTTP_RETRY_MAX_ATTEMPTS + 1 },
      () => jsonResponse(500, { message: "server error" }),
    );
    mockFetchSequence([
      ...failuresForFirstChunk,
      jsonResponse(200, { data: [livestreamFixture(1, "a")] }),
    ]);

    const ids = Array.from({ length: 150 }, (_, i) => String(i + 1));
    const result = await getKickLivestreamsByBroadcasterIds(ids);

    expect(result.length).toBe(1);
  });
});

describe("getKickStreamsByCategory", () => {
  function livestreamFixture(id: number, username: string) {
    return {
      id: `stream-${id}`,
      title: "t",
      broadcaster_user: { id, username },
      category: { id: 1, name: "Just Chatting" },
      channel: { slug: username },
      viewer_count: 10,
      language_code: "en",
      started_at: "2026-08-09T10:00:00Z",
    };
  }

  test("returns streams from a single page (no cursor)", async () => {
    mockFetchSequence([
      jsonResponse(200, { data: [livestreamFixture(1, "a")] }),
    ]);

    const result = await getKickStreamsByCategory("1", "en");
    expect(result.length).toBe(1);
  });

  test("follows pagination cursor across multiple pages", async () => {
    const urls = mockFetchSequence([
      jsonResponse(200, {
        data: [livestreamFixture(1, "a")],
        pagination: { next_cursor: "page2" },
      }),
      jsonResponse(200, {
        data: [livestreamFixture(2, "b")],
        pagination: { next_cursor: null },
      }),
    ]);

    const result = await getKickStreamsByCategory("1", "en");

    expect(result.length).toBe(2);
    expect(urls.length).toBe(2);
    expect(urls[1]).toContain("cursor=page2");
  });

  test("stops and returns partial results on an error mid-pagination", async () => {
    mockFetchSequence([
      jsonResponse(200, {
        data: [livestreamFixture(1, "a")],
        pagination: { next_cursor: "page2" },
      }),
      jsonResponse(500, { message: "server error" }),
    ]);

    const result = await getKickStreamsByCategory("1", "en");
    expect(result.length).toBe(1);
  });
});
