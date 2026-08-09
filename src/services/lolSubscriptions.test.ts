import { describe, expect, test } from "bun:test";
import { addLoLSubscription } from "./lolSubscriptions";

describe("addLoLSubscription validation", () => {
  test("rejects a riot id with no # separator before ever calling the Riot API", async () => {
    const result = await addLoLSubscription("g1", "c1", "NameWithoutTag", "eune");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Name#Tag/);
    }
  });

  test("rejects a riot id missing the name before the #", async () => {
    const result = await addLoLSubscription("g1", "c1", "#EUNE", "eune");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/before and after/);
    }
  });

  test("rejects a riot id missing the tag after the #", async () => {
    const result = await addLoLSubscription("g1", "c1", "PlayerName#", "eune");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/before and after/);
    }
  });
});
