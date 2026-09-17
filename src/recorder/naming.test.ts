import { describe, expect, test } from "bun:test";
import {
  buildRemoteDir,
  buildRemoteName,
  buildStreamUrl,
  closedPartIndices,
  parsePartIndex,
  SEGMENT_PATTERN,
} from "./naming";

describe("buildStreamUrl", () => {
  test("builds a Twitch channel URL", () => {
    expect(buildStreamUrl("twitch", "alice")).toBe("https://twitch.tv/alice");
  });

  test("builds a Kick channel URL from the slug", () => {
    expect(buildStreamUrl("kick", "some-streamer")).toBe(
      "https://kick.com/some-streamer",
    );
  });
});

describe("parsePartIndex", () => {
  test("reads the index out of a segment filename", () => {
    expect(parsePartIndex("part_00042.mp4")).toBe(42);
  });

  test("reads index zero", () => {
    expect(parsePartIndex("part_00000.mp4")).toBe(0);
  });

  test("ignores files that are not segments", () => {
    expect(parsePartIndex("notes.txt")).toBeNull();
    expect(parsePartIndex("part_.mp4")).toBeNull();
    expect(parsePartIndex("part_abc.mp4")).toBeNull();
    expect(parsePartIndex(".part_00001.mp4.tmp")).toBeNull();
  });

  test("accepts a full path, not just a basename", () => {
    expect(parsePartIndex("/data/recordings/7/part_00003.mp4")).toBe(3);
  });
});

describe("closedPartIndices", () => {
  // ffmpeg is still writing the highest-numbered segment, so uploading it
  // would ship a truncated file with no moov atom.
  test("excludes the highest index while the capture is still running", () => {
    expect(
      closedPartIndices(
        ["part_00000.mp4", "part_00001.mp4", "part_00002.mp4"],
        false,
      ),
    ).toEqual([0, 1]);
  });

  test("includes every segment once the capture has exited", () => {
    expect(
      closedPartIndices(
        ["part_00000.mp4", "part_00001.mp4", "part_00002.mp4"],
        true,
      ),
    ).toEqual([0, 1, 2]);
  });

  test("returns nothing when only the in-progress segment exists", () => {
    expect(closedPartIndices(["part_00000.mp4"], false)).toEqual([]);
  });

  test("returns nothing for an empty directory", () => {
    expect(closedPartIndices([], false)).toEqual([]);
    expect(closedPartIndices([], true)).toEqual([]);
  });

  test("ignores unrelated files", () => {
    expect(
      closedPartIndices(["part_00000.mp4", "part_00001.mp4", "README"], false),
    ).toEqual([0]);
  });

  // Directory listings are not ordered, and "highest" must be numeric — a
  // lexical max would call part_00009 the newest once part_00010 exists.
  test("sorts numerically regardless of listing order", () => {
    expect(
      closedPartIndices(
        ["part_00010.mp4", "part_00002.mp4", "part_00009.mp4"],
        false,
      ),
    ).toEqual([2, 9]);
  });
});

describe("buildRemoteDir", () => {
  const archive = {
    platform: "twitch" as const,
    streamer_login: "alice",
    stream_id: "48231",
    started_at: "2026-01-15T22:30:00Z",
  };

  test("groups a broadcast under platform, streamer and start date", () => {
    expect(buildRemoteDir("gdrive:Barker VODs", archive)).toBe(
      "gdrive:Barker VODs/twitch/alice/2026-01-15_48231",
    );
  });

  test("tolerates a remote written with a trailing slash", () => {
    expect(buildRemoteDir("gdrive:Barker VODs/", archive)).toBe(
      "gdrive:Barker VODs/twitch/alice/2026-01-15_48231",
    );
  });

  // Stream ids come from the platform, so a path separator in one would
  // otherwise silently scatter parts across directories.
  test("strips characters that would change the directory structure", () => {
    expect(
      buildRemoteDir("gdrive:VODs", { ...archive, stream_id: "a/b..c" }),
    ).toBe("gdrive:VODs/twitch/alice/2026-01-15_a-b-c");
  });
});

describe("buildRemoteName", () => {
  test("zero-pads so parts sort correctly in a file listing", () => {
    expect(buildRemoteName(7)).toBe("part_00007.mp4");
    expect(buildRemoteName(0)).toBe("part_00000.mp4");
  });

  test("round-trips with parsePartIndex", () => {
    expect(parsePartIndex(buildRemoteName(123))).toBe(123);
  });

  test("matches the pattern handed to ffmpeg", () => {
    expect(SEGMENT_PATTERN).toBe("part_%05d.mp4");
  });
});
