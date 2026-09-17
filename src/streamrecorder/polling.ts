import { env } from "../config";
import { logger } from "../utils/logger";
import type { Platform } from "../types";
import {
  FEED_PAGE_SIZE,
  PLATFORM_FEED_IDS,
  channelPageUrl,
  fetchChannelPlayback,
  fetchLatestRecordings,
} from "./client";
import { parseStreamRecorderTargets, type StreamRecorderTarget } from "./targets";
import {
  latestVodIdForTarget,
  setVodPlaybackUrl,
  upsertStreamRecorderVods,
  type NewStreamRecorderVod,
} from "../database/repositories/streamRecorderVods";

// Parsed once at load, like the chat targets: a malformed STREAMRECORDER_CHANNELS
// has to stop the bot at startup rather than leave a channel quietly untracked.
let targets: StreamRecorderTarget[] = [];
if (env.STREAMRECORDER_ENABLED) {
  targets = parseStreamRecorderTargets(env.STREAMRECORDER_CHANNELS);
  logger.info(
    `[StreamRecorder] Tracking ${targets.length} channel(s): ${targets
      .map((target) => `${target.platform}:${target.login}`)
      .join(", ")}`,
  );
}

export function isStreamRecorderEnabled(): boolean {
  return env.STREAMRECORDER_ENABLED;
}

export function streamRecorderTargets(): StreamRecorderTarget[] {
  return targets;
}

// Their platform label, which is what a row is stored under. The numeric feed id
// only picks which feed to read.
function platformFromIcon(icon: string | null | undefined): Platform | null {
  return icon === "twitch" || icon === "kick" ? icon : null;
}

// One pass over the feed. The feed is global and cannot be filtered by channel,
// so this walks a few pages per platform and keeps the rows whose channel is one
// of ours — the poll interval is what makes catching a new recording a matter of
// time rather than luck.
export async function pollStreamRecorderOnce(): Promise<number> {
  if (!env.STREAMRECORDER_ENABLED || targets.length === 0) return 0;

  const wanted = new Set(
    targets.map((target) => `${target.platform}:${target.login}`),
  );
  const platforms = Array.from(new Set(targets.map((target) => target.platform)));
  const collected: NewStreamRecorderVod[] = [];

  for (const platform of platforms) {
    const feedId = PLATFORM_FEED_IDS[platform];
    if (feedId === undefined) continue;

    for (let page = 0; page < env.STREAMRECORDER_PAGES; page += 1) {
      const recordings = await fetchLatestRecordings(feedId, page * FEED_PAGE_SIZE);
      if (recordings.length === 0) break;

      for (const recording of recordings) {
        const labelled = platformFromIcon(recording.iconid) ?? platform;
        const target = recording.target.trim().toLowerCase();
        if (!wanted.has(`${labelled}:${target}`)) continue;

        collected.push({
          id: recording.id,
          platform: labelled,
          target,
          targetId: recording.targetid ?? null,
          title: recording.streamtitle ?? null,
          category: recording.streamcategory ?? null,
          recordedAt: recording.recorded_at,
          durationSeconds: recording.duration ?? null,
          status: recording.status,
          posterUrl: recording.poster ?? null,
          pageUrl: channelPageUrl(labelled, target),
          viewers: recording.viewers ?? null,
          resolutions: recording.resolutions ?? null,
        });
      }
    }
  }

  if (collected.length === 0) return 0;

  const written = upsertStreamRecorderVods(collected);
  logger.info(
    `[StreamRecorder] ${collected.length} recording(s) for our channels, ${written} row(s) written`,
  );
  return written;
}

// Only a channel's newest recording has public playback, and its URL is signed
// and expires — so this re-reads the channel page on every pass and stores what
// it finds against the row we hold for that recording.
export async function refreshPlaybackUrls(): Promise<void> {
  if (!env.STREAMRECORDER_ENABLED) return;

  for (const target of targets) {
    const { recordingId, playbackUrl } = await fetchChannelPlayback(
      target.platform,
      target.login,
    );
    if (recordingId === null || playbackUrl === null) continue;

    const known = latestVodIdForTarget(target.platform, target.login);
    if (known !== recordingId) continue;

    setVodPlaybackUrl(recordingId, playbackUrl);
  }
}

let isPolling = false;

export function startStreamRecorderPolling(): void {
  if (!env.STREAMRECORDER_ENABLED) return;

  const tick = async (): Promise<void> => {
    if (isPolling) return;
    isPolling = true;

    try {
      await pollStreamRecorderOnce();
      await refreshPlaybackUrls();
    } catch (error) {
      // A poll is best-effort by nature: their site being down must not take the
      // bot with it, and the next tick starts over.
      logger.error("[StreamRecorder] Poll failed:", error);
    } finally {
      isPolling = false;
    }
  };

  void tick();

  const timer = setInterval(() => void tick(), env.STREAMRECORDER_POLL_INTERVAL_MS);
  timer.unref?.();
}
