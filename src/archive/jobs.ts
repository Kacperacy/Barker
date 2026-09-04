import { env } from "../config";
import { logger } from "../utils/logger";
import type { Platform } from "../types";
import {
  createArchive,
  markEnded,
} from "../database/repositories/vodArchives";
import {
  normalizeArchiveLogin,
  parseArchiveTargets,
  shouldArchive,
  type ArchiveTarget,
} from "./targets";

// Parsed once at load: a malformed ARCHIVE_STREAMERS should stop the bot at
// startup, not silently skip a streamer whose VOD is then lost for good.
let targets: ArchiveTarget[] = [];
if (env.ARCHIVE_ENABLED) {
  targets = parseArchiveTargets(env.ARCHIVE_STREAMERS);
  logger.info(
    `[Archive] Archiving ${targets.length} streamer(s): ${targets
      .map((t) => `${t.platform}:${t.login}`)
      .join(", ")}`,
  );
}

export function isArchiveTarget(platform: Platform, login: string): boolean {
  return env.ARCHIVE_ENABLED && shouldArchive(targets, platform, login);
}

// Called on every go-live signal. Idempotent by (platform, login, streamId),
// so Kick's polling loop re-reporting a live stream each tick is harmless.
export function recordStreamStart(input: {
  platform: Platform;
  login: string;
  streamId: string;
  title?: string | null;
  startedAt: string;
}): void {
  if (!isArchiveTarget(input.platform, input.login)) return;

  const login = normalizeArchiveLogin(input.platform, input.login);

  try {
    createArchive({
      platform: input.platform,
      streamerLogin: login,
      streamId: input.streamId,
      title: input.title ?? null,
      startedAt: input.startedAt,
    });
  } catch (error) {
    // Archiving must never take the announcement path down with it.
    logger.error(`[Archive] Could not queue ${input.platform}/${login}:`, error);
  }
}

// Called on every offline signal. This is the authoritative "the broadcast is
// over" that tells the recorder to stop rather than retry the capture.
export function recordStreamEnd(platform: Platform, login: string): void {
  if (!isArchiveTarget(platform, login)) return;

  const normalized = normalizeArchiveLogin(platform, login);

  try {
    const ended = markEnded(platform, normalized);
    if (ended) {
      logger.info(
        `[Archive] Marked ${platform}/${normalized} broadcast ${ended.stream_id} as ended`,
      );
    }
  } catch (error) {
    logger.error(`[Archive] Could not close ${platform}/${normalized}:`, error);
  }
}
