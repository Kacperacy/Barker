import { describe, expect, mock, test } from "bun:test";

// addStreamerSubscription validates via the real Twitch API before writing
// anything, so mock twitch/api.ts and twitch/eventsub.ts to control that
// outcome without making network calls or touching the database (the
// "not found" path returns before any repository write or subscribe call).
mock.module("../twitch/api", () => ({
  getTwitchUserId: async () => null,
  getTwitchCategoryId: async () => null,
  unsubscribeFromStreamerEvents: async () => {},
}));
mock.module("../twitch/eventsub", () => ({
  subscribeToStreamer: async () => {},
}));

const { addCategorySubscription, addStreamerSubscription } = await import(
  "./twitchSubscriptions"
);

describe("addStreamerSubscription validation", () => {
  test("returns ok:false without saving when the username can't be resolved on Twitch", async () => {
    const result = await addStreamerSubscription(
      "g1",
      "c1",
      "nosuchstreamer",
      null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/nosuchstreamer/);
    }
  });
});

describe("addCategorySubscription validation", () => {
  test("returns ok:false without saving when the category can't be found on Twitch", async () => {
    const result = await addCategorySubscription(
      "g1",
      "c1",
      "NoSuchCategory",
      "en",
      null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/NoSuchCategory/);
    }
  });
});
