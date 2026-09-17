import { describe, expect, test } from "bun:test";
import { buildFfmpegArgs, buildStreamlinkArgs } from "./pipeline";

const base = {
  url: "https://twitch.tv/alice",
  platform: "twitch" as const,
  quality: "best",
};

describe("buildStreamlinkArgs", () => {
  test("writes to stdout so ffmpeg can segment the pipe", () => {
    const args = buildStreamlinkArgs(base);
    expect(args).toContain("--stdout");
  });

  test("puts the url and quality selector last, in that order", () => {
    const args = buildStreamlinkArgs({ ...base, quality: "720p60" });
    expect(args.slice(-2)).toEqual(["https://twitch.tv/alice", "720p60"]);
  });

  // Twitch splices ads into the stream itself; without this the archive
  // contains them.
  test("disables ads on Twitch", () => {
    expect(buildStreamlinkArgs(base)).toContain("--twitch-disable-ads");
  });

  test("does not pass Twitch-only flags for Kick", () => {
    const args = buildStreamlinkArgs({
      url: "https://kick.com/bob",
      platform: "kick",
      quality: "best",
    });
    expect(args.some((a) => a.startsWith("--twitch-"))).toBe(false);
  });

  // A dropped HLS segment mid-broadcast should be retried rather than ending
  // the capture, which would otherwise truncate a multi-hour archive.
  test("retries individual stream segments", () => {
    const args = buildStreamlinkArgs(base);
    expect(args).toContain("--stream-segment-attempts");
    expect(args[args.indexOf("--stream-segment-attempts") + 1]).toBe("5");
  });

  test("falls back to another quality when the requested one is absent", () => {
    const args = buildStreamlinkArgs({ ...base, quality: "1080p60" });
    expect(args).toContain("--default-stream");
    expect(args[args.indexOf("--default-stream") + 1]).toBe("1080p60,best");
  });

  test("does not build a redundant fallback when best is requested", () => {
    const args = buildStreamlinkArgs({ ...base, quality: "best" });
    expect(args[args.indexOf("--default-stream") + 1]).toBe("best");
  });
});

describe("buildFfmpegArgs", () => {
  const opts = { outputDir: "/data/7", segmentSeconds: 3600, startNumber: 0 };

  test("reads the pipe and remuxes without re-encoding", () => {
    const args = buildFfmpegArgs(opts);
    expect(args).toContain("pipe:0");
    expect(args.slice(args.indexOf("-c"), args.indexOf("-c") + 2)).toEqual([
      "-c",
      "copy",
    ]);
  });

  test("segments at the configured interval", () => {
    const args = buildFfmpegArgs({ ...opts, segmentSeconds: 900 });
    expect(args[args.indexOf("-segment_time") + 1]).toBe("900");
  });

  test("writes segments matching the pattern the uploader parses", () => {
    expect(buildFfmpegArgs(opts).at(-1)).toBe("/data/7/part_%05d.mp4");
  });

  // streamlink can exit mid-broadcast on a network blip; the supervisor
  // restarts it, and numbering has to continue rather than overwrite parts
  // that are already recorded or uploaded.
  test("resumes segment numbering after a restart", () => {
    const args = buildFfmpegArgs({ ...opts, startNumber: 12 });
    expect(args[args.indexOf("-segment_start_number") + 1]).toBe("12");
  });

  test("resets timestamps so each segment plays standalone", () => {
    const args = buildFfmpegArgs(opts);
    expect(args[args.indexOf("-reset_timestamps") + 1]).toBe("1");
  });
});
