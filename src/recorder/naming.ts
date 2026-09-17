import type { Platform } from "../types";

// Handed to ffmpeg's segment muxer verbatim. Five digits is ~57 days of
// one-minute segments — far past any plausible broadcast.
export const SEGMENT_PATTERN = "part_%05d.mp4";

const PART_FILENAME = /^part_(\d+)\.mp4$/;

export function buildStreamUrl(platform: Platform, login: string): string {
  return platform === "kick"
    ? `https://kick.com/${login}`
    : `https://twitch.tv/${login}`;
}

export function parsePartIndex(pathOrName: string): number | null {
  const name = pathOrName.split("/").pop() ?? pathOrName;
  const match = PART_FILENAME.exec(name);
  return match ? Number(match[1]) : null;
}

export function buildRemoteName(index: number): string {
  return `part_${String(index).padStart(5, "0")}.mp4`;
}

// A segment is safe to upload only once ffmpeg has moved on to the next one —
// the file it is still writing has no moov atom yet and would upload as a
// truncated, unplayable part. Once the capture exits, its last segment has
// been finalized and joins the set.
export function closedPartIndices(
  filenames: string[],
  captureFinished: boolean,
): number[] {
  const indices = filenames
    .map(parsePartIndex)
    .filter((index): index is number => index !== null)
    .sort((a, b) => a - b);

  if (captureFinished || indices.length === 0) return indices;
  return indices.slice(0, -1);
}

// Stream ids and logins come from the platforms, so anything that could
// redirect the path (separators, dot segments) is flattened rather than
// trusted.
function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function buildRemoteDir(
  remote: string,
  archive: {
    platform: Platform;
    streamer_login: string;
    stream_id: string;
    started_at: string;
  },
): string {
  const base = remote.replace(/\/+$/, "");
  const date = archive.started_at.slice(0, 10);
  const login = sanitizeSegment(archive.streamer_login);
  const streamId = sanitizeSegment(archive.stream_id);

  return `${base}/${archive.platform}/${login}/${date}_${streamId}`;
}
