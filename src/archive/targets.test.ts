import { describe, expect, test } from "bun:test";
import {
  normalizeArchiveLogin,
  parseArchiveTargets,
  shouldArchive,
} from "./targets";

describe("parseArchiveTargets", () => {
  test("parses a single platform-qualified entry", () => {
    expect(parseArchiveTargets("twitch:SomeStreamer")).toEqual([
      { platform: "twitch", login: "somestreamer" },
    ]);
  });

  test("parses several entries and tolerates whitespace around them", () => {
    expect(parseArchiveTargets(" twitch:alice , kick:bob ")).toEqual([
      { platform: "twitch", login: "alice" },
      { platform: "kick", login: "bob" },
    ]);
  });

  test("returns an empty list for an empty or whitespace-only value", () => {
    expect(parseArchiveTargets("")).toEqual([]);
    expect(parseArchiveTargets("   ")).toEqual([]);
    expect(parseArchiveTargets(",, ,")).toEqual([]);
  });

  // Kick slugs hyphenate underscores; storing the raw username would mean the
  // target never matches the slug the polling loop reports.
  test("normalizes Kick logins to slug form", () => {
    expect(parseArchiveTargets("kick:Some_Streamer")).toEqual([
      { platform: "kick", login: "some-streamer" },
    ]);
  });

  test("leaves underscores intact for Twitch, which does not hyphenate", () => {
    expect(parseArchiveTargets("twitch:Some_Streamer")).toEqual([
      { platform: "twitch", login: "some_streamer" },
    ]);
  });

  test("de-duplicates repeated targets", () => {
    expect(parseArchiveTargets("twitch:alice,twitch:Alice")).toEqual([
      { platform: "twitch", login: "alice" },
    ]);
  });

  test("keeps the same login on both platforms as two distinct targets", () => {
    expect(parseArchiveTargets("twitch:alice,kick:alice")).toEqual([
      { platform: "twitch", login: "alice" },
      { platform: "kick", login: "alice" },
    ]);
  });

  // A typo here means a streamer silently never gets archived, which would
  // only surface as a missing VOD long after the stream is gone — so this
  // fails loudly at startup instead, matching config.ts's exit-on-bad-env.
  test("throws on an unknown platform prefix", () => {
    expect(() => parseArchiveTargets("youtube:alice")).toThrow(/youtube/);
  });

  test("throws on an entry with no platform prefix", () => {
    expect(() => parseArchiveTargets("alice")).toThrow(/alice/);
  });

  test("throws on an entry with a platform but no login", () => {
    expect(() => parseArchiveTargets("twitch:")).toThrow(/twitch:/);
  });
});

describe("shouldArchive", () => {
  const targets = parseArchiveTargets("twitch:alice,kick:some-streamer");

  test("matches a configured target regardless of input casing", () => {
    expect(shouldArchive(targets, "twitch", "ALICE")).toBe(true);
  });

  test("matches a Kick target given the underscore form of the username", () => {
    expect(shouldArchive(targets, "kick", "Some_Streamer")).toBe(true);
  });

  test("does not match a login configured only on the other platform", () => {
    expect(shouldArchive(targets, "kick", "alice")).toBe(false);
  });

  test("does not match an unconfigured login", () => {
    expect(shouldArchive(targets, "twitch", "bob")).toBe(false);
  });

  test("matches nothing when no targets are configured", () => {
    expect(shouldArchive([], "twitch", "alice")).toBe(false);
  });
});

describe("normalizeArchiveLogin", () => {
  test("lowercases Twitch logins without touching underscores", () => {
    expect(normalizeArchiveLogin("twitch", "Some_Name")).toBe("some_name");
  });

  test("applies Kick slug rules to Kick logins", () => {
    expect(normalizeArchiveLogin("kick", " Some_Name ")).toBe("some-name");
  });
});
