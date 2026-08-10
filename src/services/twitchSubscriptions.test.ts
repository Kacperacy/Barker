import { describe, expect, test } from "bun:test";
import {
  addCategorySubscription,
  addStreamerSubscription,
} from "./twitchSubscriptions";

// getTwitchUserId/subscribeToStreamer/getTwitchCategoryId are injected here
// directly instead of module-mocking "../twitch/api"/"../twitch/eventsub" —
// see kick/auth.test.ts for why that's fragile (a real, previously-observed
// CI-only failure from a module mock leaking across test files).
const fakeGetTwitchUserId = async () => null;
const fakeSubscribeToStreamer = async () => {};
const fakeGetTwitchCategoryId = async () => null;

describe("addStreamerSubscription validation", () => {
  test("returns ok:false without saving when the username can't be resolved on Twitch", async () => {
    const result = await addStreamerSubscription(
      "g1",
      "c1",
      "nosuchstreamer",
      null,
      fakeGetTwitchUserId,
      fakeSubscribeToStreamer,
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
      fakeGetTwitchCategoryId,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/NoSuchCategory/);
    }
  });
});
