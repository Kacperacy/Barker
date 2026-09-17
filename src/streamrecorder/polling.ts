import { env } from "../config";
import { logger } from "../utils/logger";
import { channelPageUrl, fetchProfileArchive } from "./client";
import { parseStreamRecorderTargets, type StreamRecorderTarget } from "./targets";
import {
  clearPlaybackForTarget,
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

// Their profile publishes a day and a "HH:mm", both UTC, and nothing finer.
function recordedAt(day: string, time: string): string {
  return `${day}T${time}:00Z`;
}

// Their per-entry identity is only what the profile shows, so the key is built
// from exactly that: a channel cannot record two broadcasts with the same title
// in the same minute, and if it ever did, they would be one row.
function vodKey(target: StreamRecorderTarget, day: string, time: string, title: string): string {
  return `${target.platform}|${target.login}|${day}|${time}|${title}`;
}

// One pass over the tracked channels' profiles. Their global feed is deliberately
// not used: a small channel never appears in it (measured, 800 entries deep).
export async function pollStreamRecorderOnce(): Promise<number> {
  if (!env.STREAMRECORDER_ENABLED || targets.length === 0) return 0;

  let written = 0;

  for (const target of targets) {
    const archive = await fetchProfileArchive(target.platform, target.login);
    if (!archive || archive.recordings.length === 0) continue;

    const rows: NewStreamRecorderVod[] = archive.recordings.map((recording) => ({
      key: vodKey(target, recording.day, recording.time, recording.title),
      platform: target.platform,
      target: target.login,
      title: recording.title,
      category: recording.category,
      recordedAt: recordedAt(recording.day, recording.time),
      durationSeconds: recording.durationSeconds,
      // Their own flag in words: they are recording this channel right now, or
      // they are not.
      status: recording.isLive ? "live" : "finished",
      thumbnailUrl: recording.thumbnail,
      pageUrl: channelPageUrl(target.platform, target.login),
    }));

    written += upsertStreamRecorderVods(rows);

    // Only the recording their own player is showing has a public source, and the
    // URL is signed, so every pass refreshes it and drops it from the rest: an old
    // URL would be a card that looks playable and is not.
    if (archive.playbackUrl && archive.currentTitle) {
      const current = rows.find((row) => row.title === archive.currentTitle);
      if (current) {
        setVodPlaybackUrl(current.key, archive.playbackUrl);
        clearPlaybackForTarget(target.platform, target.login, current.key);
      }
    }
  }

  if (written > 0) {
    logger.info(`[StreamRecorder] ${written} row(s) written`);
  }

  return written;
}

let isPolling = false;

export function startStreamRecorderPolling(): void {
  if (!env.STREAMRECORDER_ENABLED) return;

  const tick = async (): Promise<void> => {
    if (isPolling) return;
    isPolling = true;

    try {
      await pollStreamRecorderOnce();
    } catch (error) {
      // Best-effort by nature: their site being down must not take the bot with
      // it, and the next tick starts over.
      logger.error("[StreamRecorder] Poll failed:", error);
    } finally {
      isPolling = false;
    }
  };

  void tick();

  const timer = setInterval(() => void tick(), env.STREAMRECORDER_POLL_INTERVAL_MS);
  timer.unref?.();
}
