import { afterEach, describe, expect, test } from "bun:test";

// getValidAppToken takes getConfig/setConfig as injectable params, so this
// uses a plain in-memory fake instead of bun:test's mock.module — avoids
// depending on module-mock semantics that proved fragile across the suite
// (a real, previously-observed CI-only failure from a leaked module mock).
import { getValidAppToken } from "./auth";
const configStore = new Map<string, string>();
const fakeGetConfig = (key: string) => configStore.get(key) ?? null;
const fakeSetConfig = (key: string, value: string) => {
  configStore.set(key, value);
};

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  configStore.clear();
});

function tokenResponse(accessToken: string, expiresIn = 3600) {
  return new Response(
    JSON.stringify({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: expiresIn,
    }),
    { status: 200 },
  );
}

describe("getValidAppToken", () => {
  test("requests and caches a new token when none is cached", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return tokenResponse("token-1");
    }) as unknown as typeof fetch;

    const token = await getValidAppToken(fakeGetConfig, fakeSetConfig);

    expect(token).toBe("token-1");
    expect(calls).toBe(1);
    expect(configStore.get("kick_app_token")).toBe("token-1");
  });

  test("returns the cached token without a new request if still valid", async () => {
    configStore.set("kick_app_token", "cached-token");
    configStore.set(
      "kick_app_token_expires_at",
      String(Date.now() + 3600 * 1000),
    );

    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return tokenResponse("should-not-be-used");
    }) as unknown as typeof fetch;

    const token = await getValidAppToken(fakeGetConfig, fakeSetConfig);

    expect(token).toBe("cached-token");
    expect(calls).toBe(0);
  });

  test("requests a new token when the cached one is expired", async () => {
    configStore.set("kick_app_token", "old-token");
    configStore.set("kick_app_token_expires_at", String(Date.now() - 1000));

    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return tokenResponse("new-token");
    }) as unknown as typeof fetch;

    const token = await getValidAppToken(fakeGetConfig, fakeSetConfig);

    expect(token).toBe("new-token");
    expect(calls).toBe(1);
  });

  test("requests a new token when the cached one is within the 60s expiry buffer", async () => {
    configStore.set("kick_app_token", "soon-to-expire");
    configStore.set(
      "kick_app_token_expires_at",
      String(Date.now() + 30_000),
    );

    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return tokenResponse("refreshed-token");
    }) as unknown as typeof fetch;

    const token = await getValidAppToken(fakeGetConfig, fakeSetConfig);

    expect(token).toBe("refreshed-token");
    expect(calls).toBe(1);
  });

  test("dedupes concurrent requests into a single token fetch", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return tokenResponse("token-x");
    }) as unknown as typeof fetch;

    const [a, b, c] = await Promise.all([
      getValidAppToken(fakeGetConfig, fakeSetConfig),
      getValidAppToken(fakeGetConfig, fakeSetConfig),
      getValidAppToken(fakeGetConfig, fakeSetConfig),
    ]);

    expect(a).toBe("token-x");
    expect(b).toBe("token-x");
    expect(c).toBe("token-x");
    expect(calls).toBe(1);
  });

  test("throws when the token request fails", async () => {
    globalThis.fetch = (async () =>
      new Response("bad credentials", { status: 401 })) as unknown as typeof fetch;

    await expect(
      getValidAppToken(fakeGetConfig, fakeSetConfig),
    ).rejects.toThrow();
  });
});
