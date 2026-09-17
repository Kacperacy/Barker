import { z } from "zod";
import { fetchWithRetry } from "../utils/http";
import { logger } from "../utils/logger";
import type { Platform } from "../types";

// StreamRecorder.io's public surface, as observed:
//
//   GET /latestoffset/<offset>/<platformId>   newest recordings, 20 per page
//   GET /<platform>/<login>                   a channel's page, which embeds its
//                                             newest recording's signed MP4
//
// There is no per-channel feed without an account (`/userrecordings` answers 401)
// and no per-recording page, so the channel page is the only public playback
// there is. The feed itself carries no media URL.
const BASE_URL = "https://streamrecorder.io";

// Page size the feed uses. Kept here so the poller can turn a page number into
// the offset the endpoint expects.
export const FEED_PAGE_SIZE = 20;

// The feed's platform ids: 1 for Twitch, 5 for Kick. Their payload also names the
// platform (`iconid`), which is what a row is labelled from — the id is only ever
// sent to them.
export const PLATFORM_FEED_IDS: Partial<Record<Platform, number>> = {
  twitch: 1,
  kick: 5,
};

// Their rows, narrowed to what the bot stores. `.passthrough()` on purpose: the
// feed is theirs to extend, and an added field must not drop a recording.
const recordingSchema = z
  .object({
    id: z.number(),
    target: z.string(),
    targetid: z.number().nullish(),
    recorded_at: z.string(),
    status: z.string(),
    streamtitle: z.string().nullish(),
    streamcategory: z.string().nullish(),
    duration: z.number().nullish(),
    poster: z.string().nullish(),
    iconid: z.string().nullish(),
    viewers: z.number().nullish(),
    resolutions: z.array(z.number()).nullish(),
  })
  .passthrough();

const feedSchema = z.array(recordingSchema);

export type StreamRecorderRecording = z.infer<typeof recordingSchema>;

export async function fetchLatestRecordings(
  platformId: number,
  offset: number,
): Promise<StreamRecorderRecording[]> {
  const res = await fetchWithRetry(
    `${BASE_URL}/latestoffset/${offset}/${platformId}`,
    {},
    { retries: 1, baseDelayMs: 500 },
  );

  if (!res.ok) {
    logger.error(`[StreamRecorder] feed answered ${res.status} for offset ${offset}`);
    return [];
  }

  const parsed = feedSchema.safeParse(await res.json());
  if (!parsed.success) {
    logger.error(`[StreamRecorder] unexpected feed shape: ${parsed.error.message}`);
    return [];
  }

  return parsed.data;
}

export interface ChannelPlayback {
  recordingId: number | null;
  playbackUrl: string | null;
}

export async function fetchChannelPlayback(
  platform: Platform,
  login: string,
): Promise<ChannelPlayback> {
  const res = await fetchWithRetry(
    `${BASE_URL}/${platform}/${login}`,
    {},
    { retries: 1, baseDelayMs: 500 },
  );

  if (!res.ok) {
    // A channel with nothing recorded answers 404, which is not an error worth
    // logging on every poll.
    if (res.status !== 404) {
      logger.error(`[StreamRecorder] channel page answered ${res.status} for ${platform}/${login}`);
    }
    return { recordingId: null, playbackUrl: null };
  }

  return parseChannelPage(await res.text());
}

// The page is server-rendered HTML with two inline constants rather than JSON, so
// this reads them directly instead of pulling in a parser: `data_recordingId` is
// which recording the player is showing, and `data_sources` its media.
export function parseChannelPage(html: string): ChannelPlayback {
  const idText = /data_recordingId\s*=\s*"(\d+)"/.exec(html)?.[1] ?? null;
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

  const recordingId = idText === null ? null : Number.parseInt(idText, 10);

  return { recordingId, playbackUrl };
}

export function channelPageUrl(platform: Platform, login: string): string {
  return `${BASE_URL}/${platform}/${login}`;
}
