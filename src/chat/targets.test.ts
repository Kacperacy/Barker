import { describe, expect, test } from "bun:test";
import { isChatLogTarget, normalizeChatLogin, parseChatTargets } from "./targets";

describe("parseChatTargets", () => {
  test("parses a platform:login list", () => {
    expect(parseChatTargets("twitch:alice,kick:alice")).toEqual([
      { platform: "twitch", login: "alice" },
      { platform: "kick", login: "alice" },
    ]);
  });

  test("normalizes logins per platform", () => {
    // Kick addresses channels by slug, so an underscore spelling has to become
    // the hyphenated form every payload uses.
    expect(parseChatTargets("kick:some_streamer")[0]?.login).toBe("some-streamer");
    expect(parseChatTargets("twitch:SomeStreamer")[0]?.login).toBe("somestreamer");
  });

  test("ignores blanks and duplicates", () => {
    expect(parseChatTargets(" , twitch:alice , twitch:alice ,")).toHaveLength(1);
  });

  test("throws on a malformed entry instead of skipping it", () => {
    // A skipped channel shows up as a log with a hole in it, long after those
    // messages are unrecoverable, so startup has to fail.
    expect(() => parseChatTargets("alice")).toThrow(/expected "<platform>:<login>"/);
    expect(() => parseChatTargets("youtube:alice")).toThrow(/unknown platform/);
    expect(() => parseChatTargets("twitch:")).toThrow(/missing login/);
  });
});

describe("isChatLogTarget", () => {
  const targets = parseChatTargets("twitch:alice,kick:alice");

  test("matches a normalized login on the right platform", () => {
    expect(isChatLogTarget(targets, "twitch", "ALICE")).toBe(true);
    expect(isChatLogTarget(targets, "kick", "alice")).toBe(true);
    expect(isChatLogTarget(targets, "kick", "some_streamer")).toBe(false);
  });
});

describe("normalizeChatLogin", () => {
  test("hyphenates Kick and lowercases Twitch", () => {
    expect(normalizeChatLogin("kick", " Klaun_0k ")).toBe("klaun-0k");
    expect(normalizeChatLogin("twitch", " Klaun___0k ")).toBe("klaun___0k");
  });
});