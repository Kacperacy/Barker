import { describe, expect, test } from "bun:test";
import {
  capitalizeFirst,
  computeLpDiff,
  computeStreak,
  getAbsoluteLp,
  isRemake,
} from "./rank";

describe("capitalizeFirst", () => {
  test("capitalizes a lowercase word", () => {
    expect(capitalizeFirst("gold")).toBe("Gold");
  });

  test("lowercases the remainder of an all-caps word", () => {
    expect(capitalizeFirst("GOLD")).toBe("Gold");
  });

  test("leaves an already-capitalized word unchanged", () => {
    expect(capitalizeFirst("Gold")).toBe("Gold");
  });

  test("returns empty string for empty input", () => {
    expect(capitalizeFirst("")).toBe("");
  });
});

describe("getAbsoluteLp", () => {
  test("Iron IV 0 LP is the baseline", () => {
    expect(getAbsoluteLp("IRON", "IV", 0)).toBe(0);
  });

  test("Gold I 99 LP", () => {
    // Gold base (1200) + rank I (300) + 99 lp
    expect(getAbsoluteLp("GOLD", "I", 99)).toBe(1599);
  });

  test("tier lookup is case-insensitive", () => {
    expect(getAbsoluteLp("gold", "i", 99)).toBe(1599);
  });

  test("Master tier ignores rank division entirely", () => {
    expect(getAbsoluteLp("MASTER", "I", 250)).toBe(3050);
    expect(getAbsoluteLp("MASTER", "IV", 250)).toBe(3050);
  });

  test("Grandmaster and Challenger share Master's base", () => {
    expect(getAbsoluteLp("GRANDMASTER", "I", 500)).toBe(3300);
    expect(getAbsoluteLp("CHALLENGER", "I", 500)).toBe(3300);
  });

  test("unknown/garbage tier falls back to base 0", () => {
    expect(getAbsoluteLp("NOT_A_TIER", "IV", 50)).toBe(50);
  });

  test("empty tier returns 0 regardless of rank/lp", () => {
    expect(getAbsoluteLp("", "IV", 999)).toBe(0);
  });
});

describe("computeLpDiff", () => {
  test("returns null when there is no prior tier (first tracked match)", () => {
    expect(computeLpDiff(null, "", null, "GOLD", "I", 10)).toBeNull();
    expect(computeLpDiff(undefined, "", undefined, "GOLD", "I", 10)).toBeNull();
  });

  test("positive LP gain within the same division", () => {
    const result = computeLpDiff("GOLD", "I", 90, "GOLD", "I", 95);
    expect(result).not.toBeNull();
    expect(result?.lpChange).toBe(5);
    expect(result?.lpChangeText).toBe(" (+5)");
  });

  test("LP loss produces a negative diff and text", () => {
    const result = computeLpDiff("GOLD", "I", 50, "GOLD", "I", 30);
    expect(result?.lpChange).toBe(-20);
    expect(result?.lpChangeText).toBe(" (-20)");
  });

  test("zero net change renders as (+0)", () => {
    const result = computeLpDiff("GOLD", "I", 50, "GOLD", "I", 50);
    expect(result?.lpChange).toBe(0);
    expect(result?.lpChangeText).toBe(" (+0)");
  });

  test("promotion across a tier boundary sums correctly", () => {
    // Gold I 90 -> Platinum IV 5
    // old: 1200 + 300 + 90 = 1590
    // new: 1600 + 0 + 5 = 1605
    const result = computeLpDiff("GOLD", "I", 90, "PLATINUM", "IV", 5);
    expect(result?.lpChange).toBe(15);
  });

  test("null oldLp is treated as 0", () => {
    const result = computeLpDiff("GOLD", "I", null, "GOLD", "I", 10);
    expect(result?.lpChange).toBe(10);
  });
});

describe("isRemake", () => {
  test("true when gameEndedInEarlySurrender is true, regardless of duration", () => {
    expect(isRemake(1200, true)).toBe(true);
  });

  test("true when duration is below the threshold", () => {
    expect(isRemake(299, false)).toBe(true);
  });

  test("false exactly at the threshold (boundary is exclusive)", () => {
    expect(isRemake(300, false)).toBe(false);
  });

  test("false for a normal-length, non-surrendered game", () => {
    expect(isRemake(1500, false)).toBe(false);
  });

  test("treats undefined surrender flag as falsy", () => {
    expect(isRemake(1500, undefined)).toBe(false);
  });
});

describe("computeStreak", () => {
  test("empty history has no streak", () => {
    expect(computeStreak([])).toBe("None");
  });

  test("all wins", () => {
    expect(
      computeStreak([
        { win: 1, is_remake: 0 },
        { win: 1, is_remake: 0 },
        { win: 1, is_remake: 0 },
      ]),
    ).toBe("3W");
  });

  test("all losses", () => {
    expect(
      computeStreak([
        { win: 0, is_remake: 0 },
        { win: 0, is_remake: 0 },
      ]),
    ).toBe("2L");
  });

  test("streak stops at the first result change", () => {
    expect(
      computeStreak([
        { win: 1, is_remake: 0 },
        { win: 1, is_remake: 0 },
        { win: 0, is_remake: 0 },
        { win: 1, is_remake: 0 },
      ]),
    ).toBe("2W");
  });

  test("remakes in the middle are skipped, not counted or breaking the streak", () => {
    expect(
      computeStreak([
        { win: 1, is_remake: 0 },
        { win: 0, is_remake: 1 },
        { win: 1, is_remake: 0 },
        { win: 0, is_remake: 0 },
      ]),
    ).toBe("2W");
  });

  test("all remakes yields no streak", () => {
    expect(
      computeStreak([
        { win: 1, is_remake: 1 },
        { win: 0, is_remake: 1 },
      ]),
    ).toBe("None");
  });
});
