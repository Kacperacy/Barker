import { describe, expect, mock, test } from "bun:test";

// addStreamerSubscription/addCategorySubscription validate via the real Kick
// API before writing anything, so mock kick/api.ts to control that outcome
// without making network calls or touching the database (the "not found"
// paths return before any repository write happens).
mock.module("../kick/api", () => ({
  getKickBroadcasterId: async () => null,
  getKickCategoryId: async () => null,
}));

const { addCategorySubscription, addStreamerSubscription } = await import(
  "./kickSubscriptions"
);

describe("addStreamerSubscription validation", () => {
  test("returns ok:false without saving when the slug can't be resolved on Kick", async () => {
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
  test("returns ok:false without saving when the category can't be found on Kick", async () => {
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
