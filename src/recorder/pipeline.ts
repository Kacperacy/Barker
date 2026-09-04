import { join } from "node:path";
import type { Platform } from "../types";
import { logger } from "../utils/logger";
import { SEGMENT_PATTERN } from "./naming";

export interface StreamlinkOptions {
  url: string;
  platform: Platform;
  quality: string;
}

export interface FfmpegOptions {
  outputDir: string;
  segmentSeconds: number;
  startNumber: number;
}

export function buildStreamlinkArgs(opts: StreamlinkOptions): string[] {
  const args = [
    "--stdout",
    "--loglevel",
    "error",
    // A single failed HLS segment is a blip, not the end of the broadcast;
    // giving up on it would truncate a multi-hour archive.
    "--stream-segment-attempts",
    "5",
    "--stream-segment-timeout",
    "20",
    // Fall back to any available quality rather than failing outright when
    // the requested rendition is missing (a streamer's transcodes vary).
    "--default-stream",
    opts.quality === "best" ? "best" : `${opts.quality},best`,
  ];

  if (opts.platform === "twitch") {
    args.push("--twitch-disable-ads");
  }

  args.push(opts.url, opts.quality);
  return args;
}

export function buildFfmpegArgs(opts: FfmpegOptions): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    "pipe:0",
    // Stream copy: no transcode, so capture costs almost no CPU and the
    // archive keeps the broadcaster's original quality.
    "-c",
    "copy",
    "-f",
    "segment",
    "-segment_time",
    String(opts.segmentSeconds),
    "-segment_start_number",
    String(opts.startNumber),
    "-reset_timestamps",
    "1",
    "-segment_format",
    "mp4",
    join(opts.outputDir, SEGMENT_PATTERN),
  ];
}

export interface CapturePipeline {
  // Resolves with ffmpeg's exit code once the last segment is finalized.
  exited: Promise<number>;
  // Graceful: ends the source so ffmpeg sees EOF and closes its current
  // segment properly. Killing ffmpeg directly would leave that segment
  // without a moov atom, i.e. unplayable.
  stop(): void;
}

export interface CaptureOptions extends StreamlinkOptions, FfmpegOptions {}

export type StartCapture = (opts: CaptureOptions) => CapturePipeline;

export const startCapture: StartCapture = (opts) => {
  const streamlink = Bun.spawn(
    ["streamlink", ...buildStreamlinkArgs(opts)],
    { stdout: "pipe", stderr: "pipe" },
  );

  const ffmpeg = Bun.spawn(["ffmpeg", ...buildFfmpegArgs(opts)], {
    stdin: streamlink.stdout,
    stdout: "ignore",
    stderr: "pipe",
  });

  void logStderr("streamlink", streamlink.stderr);
  void logStderr("ffmpeg", ffmpeg.stderr);

  return {
    exited: ffmpeg.exited,
    stop() {
      // Only the source is signalled; ffmpeg is left to drain the pipe and
      // finalize on its own.
      streamlink.kill();
    },
  };
};

async function logStderr(name: string, stream: ReadableStream | undefined) {
  if (!stream) return;
  const text = await new Response(stream).text();
  const trimmed = text.trim();
  if (trimmed) logger.warn(`[Recorder] ${name}: ${trimmed}`);
}
