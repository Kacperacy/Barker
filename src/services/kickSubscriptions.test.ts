import { describe, expect, test } from "bun:test";
import { addCategorySubscription, addStreamerSubscription } from "./kickSubscriptions";

// getKickBroadcasterId/getKickCategoryId are injected here directly instead
// of module-mocking "../kick/api" — that module is also imported for real by
// kick/api.test.ts, and bun's mock.module is a global registry replacement
// sensitive to file load order, which previously caused a CI-only failure.
const fakeGetKickBroadcasterId = async () => null;
const fakeGetKickCategoryId = async () => null;

describe("addStreamerSubscription validation", () => {
  test("returns ok:false without saving when the slug can't be resolved on Kick", async () => {
    const result = await addStreamerSubscription(
      "g1",
      "c1",
      "nosuchstreamer",
      null,
      fakeGetKickBroadcasterId,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/nosuchstreamer/);
    }
  });
});

describe("addCategorySubscription validation", () => {
  test("returns ok:false without saving when the category can't be found on Kick", async () => {
    const result = await addCategorySubscription(
      "g1",
      "c1",
      "NoSuchCategory",
      "en",
      null,
      fakeGetKickCategoryId,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/NoSuchCategory/);
    }
  });
});
