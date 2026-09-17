import { fetchWithRetry } from "../utils/http";
import { logger } from "../utils/logger";
import type { Platform } from "../types";

// StreamRecorder.io's public surface, as observed:
//
//   GET /<platform>/<login>   a channel's profile page, whose inline
//                             `window.ALT_DAILY_DATA` lists that channel's
//                             recordings grouped by day — title, category,
//                             duration, time and `is_live`, which is the only
//                             status they publish
//   GET /latestoffset/...     a global feed of the newest recordings anywhere,
//                             which a small channel never appears in (measured:
//                             800 entries deep, zero rows for this channel), so
//                             it is deliberately not used
//
// Nothing here downloads or stores video: the page's `data_sources` entry is the
// one signed MP4 the profile exposes, and it is stored as a URL.
const BASE_URL = "https://streamrecorder.io";

// One recording, as the profile page lists it.
export interface ProfileRecording {
  // The day it was recorded, "YYYY-MM-DD" — the blob's group key.
  day: string;
  // "HH:mm", the only time they publish for a recording.
  time: string;
  title: string;
  category: string | null;
  durationSeconds: number;
  // While a recording is in progress this is true; it is their status by another
  // name, and everything older is finished.
  isLive: boolean;
  thumbnail: string | null;
}

export interface ProfileArchive {
  recordings: ProfileRecording[];
  // The recording the page's own player is showing, and the only one it publishes
  // a source for.
  currentRecordingId: string | null;
  currentTitle: string | null;
  playbackUrl: string | null;
}

export async function fetchProfileArchive(
  platform: Platform,
  login: string,
): Promise<ProfileArchive | null> {
  const res = await fetchWithRetry(
    `${BASE_URL}/${platform}/${login}`,
    {},
    { retries: 1, baseDelayMs: 500 },
  );

  if (!res.ok) {
    // A channel StreamRecorder has never recorded answers 404, which is not an
    // error worth logging on every poll.
    if (res.status !== 404) {
      logger.error(
        `[StreamRecorder] profile answered ${res.status} for ${platform}/${login}`,
      );
    }
    return null;
  }

  return parseProfileArchive(await res.text());
}

// The blob is a JS object literal with nested objects and arrays, so the closing
// brace that ends it is found by counting, not by a lazy regex: `};` appears
// inside the nested data and would truncate it.
export function extractAltDailyData(html: string): string | null {
  const marker = "ALT_DAILY_DATA";
  const start = html.indexOf(marker);
  if (start === -1) return null;

  const open = html.indexOf("{", start);
  if (open === -1) return null;

  let depth = 0;
  for (let i = open; i < html.length; i += 1) {
    const char = html[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(open, i + 1);
    }
  }

  return null;
}

interface DailyGroup {
  streams?: {
    category?: unknown;
    duration?: unknown;
    is_live?: unknown;
    thumbnail?: unknown;
    time?: unknown;
    title?: unknown;
  }[];
}

export function parseProfileArchive(html: string): ProfileArchive {
  const blob = extractAltDailyData(html);
  const recordings: ProfileRecording[] = [];

  if (blob) {
    try {
      const parsed: unknown = JSON.parse(blob);
      if (parsed !== null && typeof parsed === "object") {
        for (const [day, rawGroup] of Object.entries(parsed as Record<string, unknown>)) {
          const group = rawGroup as DailyGroup | null;
          if (!group || !Array.isArray(group.streams)) continue;

          for (const stream of group.streams) {
            if (typeof stream.title !== "string" || stream.title === "") continue;

            recordings.push({
              day,
              time: typeof stream.time === "string" ? stream.time : "00:00",
              title: stream.title,
              category:
                typeof stream.category === "string" && stream.category !== ""
                  ? stream.category
                  : null,
              durationSeconds:
                typeof stream.duration === "number" ? stream.duration : 0,
              isLive: stream.is_live === true,
              thumbnail:
                typeof stream.thumbnail === "string" ? stream.thumbnail : null,
            });
          }
        }
      }
    } catch (error) {
      logger.error(`[StreamRecorder] could not read the profile archive: ${String(error)}`);
    }
  }

  // The page's inline constants describe the recording its player is showing.
  const idText = /data_recordingId\s*=\s*"(\d+)"/.exec(html)?.[1] ?? null;
  const titleText = /data_title\s*=\s*'([^']*)'/.exec(html)?.[1] ?? null;
  const sourcesText =
    /data_sources\s*=\s*(\[[\s\S]*?\])\s*;/.exec(html)?.[1] ?? null;

  let playbackUrl: string | null = null;
  if (sourcesText) {
    try {
      const sources: unknown = JSON.parse(sourcesText);
      if (Array.isArray(sources)) {
        for (const source of sources) {
          const src = (source as { src?: unknown } | null)?.src;
          if (typeof src === "string" && src.startsWith("https://")) {
            playbackUrl = src;
            break;
          }
        }
      }
    } catch {
      playbackUrl = null;
    }
  }

  return {
    recordings,
    currentRecordingId: idText,
    currentTitle: titleText,
    playbackUrl,
  };
}

export function channelPageUrl(platform: Platform, login: string): string {
  return `${BASE_URL}/${platform}/${login}`;
}
