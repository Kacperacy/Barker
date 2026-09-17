import { mkdir, readdir } from "node:fs/promises";
import { statfsSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { env } from "../config";
import { logger } from "../utils/logger";
import {
  countUploadedParts,
  getArchive,
  getParts,
  updateArchive,
  type VodArchive,
} from "../database/repositories/vodArchives";
import { findArchivedVideoId } from "../twitch/api";
import {
  buildVideoUrl,
  buildVodCandidateUrls,
  findExistingVodUrl,
} from "./recovery";
import { buildRemoteDir, buildStreamUrl, parsePartIndex } from "./naming";
import { startCapture as realStartCapture, type StartCapture } from "./pipeline";
import {
  defaultUploaderDeps,
  drainClosedParts,
  type UploaderDeps,
} from "./uploader";

export interface CaptureDeps {
  db?: Database;
  startCapture: StartCapture;
  uploader: Omit<UploaderDeps, "db">;
  ensureDir: (dir: string) => Promise<void>;
  listDir: (dir: string) => Promise<string[]>;
  freeBytes: (dir: string) => Promise<number>;
  sleep: (ms: number) => Promise<void>;
  // Aborted on shutdown: the capture is asked to stop so ffmpeg finalizes its
  // current segment, and the restart loop does not start another one.
  signal?: AbortSignal;
  // Resolves a stream URL for a broadcast that was never captured live, or
  // null when the VOD is unrecoverable.
  findRecoverySource: (archive: VodArchive) => Promise<string | null>;
}

export const defaultCaptureDeps: CaptureDeps = {
  startCapture: realStartCapture,
  uploader: defaultUploaderDeps,
  ensureDir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
  listDir: (dir) => readdir(dir),
  freeBytes: async (dir) => {
    const stats = statfsSync(dir);
    return stats.bavail * stats.bsize;
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  // A still-published VOD is both cheaper and higher fidelity than probing
  // CDN paths, so it is tried first.
  findRecoverySource: async (archive) => {
    const videoId = await findArchivedVideoId(
      archive.streamer_login,
      archive.stream_id,
    );
    if (videoId) return buildVideoUrl(videoId);

    return findExistingVodUrl(
      buildVodCandidateUrls(
        archive.streamer_login,
        archive.stream_id,
        archive.started_at,
      ),
    );
  },
};

// How often the uploader sweeps for segments ffmpeg has closed. Short relative
// to segment length, so a finished segment leaves the disk promptly.
const DRAIN_INTERVAL_MS = 15_000;

// A capture that exits without producing anything is treated as the stream
// being gone. A few retries cover a genuine network blip; beyond that,
// retrying forever would spin against an offline channel.
const MAX_FRUITLESS_RESTARTS = 3;
const RESTART_DELAY_MS = 20_000;

export function localDirFor(archiveId: number): string {
  return join(env.ARCHIVE_WORK_DIR, String(archiveId));
}

// Numbering must continue past anything already on disk or already uploaded,
// or a restarted ffmpeg would overwrite earlier segments of the same broadcast.
export function nextStartNumber(
  filenames: string[],
  recordedIndices: number[],
): number {
  const indices = [
    ...filenames
      .map(parsePartIndex)
      .filter((index): index is number => index !== null),
    ...recordedIndices,
  ];
  return indices.length === 0 ? 0 : Math.max(...indices) + 1;
}

async function hasRoomToRecord(
  dir: string,
  deps: CaptureDeps,
): Promise<boolean> {
  try {
    const free = await deps.freeBytes(dir);
    return free >= env.ARCHIVE_MIN_FREE_DISK_GB * 1024 ** 3;
  } catch (error) {
    logger.warn(`[Recorder] Could not determine free space for ${dir}: ${error}`);
    return true;
  }
}

// Runs one broadcast end to end: capture, segment, upload, clean up. Returns
// when the stream is over and everything that could be uploaded has been.
export async function runArchive(
  archive: VodArchive,
  deps: CaptureDeps = defaultCaptureDeps,
): Promise<void> {
  const db = deps.db;
  const dir = localDirFor(archive.id);
  const remoteDir = buildRemoteDir(env.ARCHIVE_RCLONE_REMOTE, archive);
  const uploader: UploaderDeps = { ...deps.uploader, db };

  await deps.ensureDir(dir);
  updateArchive(archive.id, { drive_folder: remoteDir }, db);

  if (!(await hasRoomToRecord(dir, deps))) {
    const message = `Refusing to record: less than ${env.ARCHIVE_MIN_FREE_DISK_GB} GB free`;
    logger.error(`[Recorder] ${message}`);
    updateArchive(archive.id, { status: "failed", error: message }, db);
    return;
  }

  // The broadcast can already be over when this starts — the recorder was
  // down while the bot saw both the go-live and the offline. Capturing an
  // ended stream would just fail, so go straight to draining whatever
  // segments an earlier run left behind.
  if (getArchive(archive.id, db)?.ended_at) {
    logger.info(
      `[Recorder] ${archive.streamer_login} is already offline; finalizing without capture`,
    );
    await finalize(archive.id, dir, remoteDir, uploader, deps);
    return;
  }

  logger.info(
    `[Recorder] Recording ${archive.platform}/${archive.streamer_login} (stream ${archive.stream_id}) into ${dir}`,
  );

  let fruitlessRestarts = 0;

  while (true) {
    const startNumber = nextStartNumber(
      await deps.listDir(dir).catch(() => []),
      getParts(archive.id, db).map((part) => part.part_index),
    );

    const pipeline = deps.startCapture({
      url: buildStreamUrl(archive.platform, archive.streamer_login),
      platform: archive.platform,
      quality: env.ARCHIVE_QUALITY,
      outputDir: dir,
      segmentSeconds: env.ARCHIVE_SEGMENT_SECONDS,
      startNumber,
    });

    const onAbort = () => pipeline.stop();
    deps.signal?.addEventListener("abort", onAbort, { once: true });

    let finished = false;
    const exited = pipeline.exited.then((code) => {
      finished = true;
      return code;
    });

    while (!finished) {
      await deps.sleep(DRAIN_INTERVAL_MS);
      if (finished) break;
      await drainClosedParts(archive.id, dir, remoteDir, false, uploader);
    }

    await exited;
    deps.signal?.removeEventListener("abort", onAbort);
    await drainClosedParts(archive.id, dir, remoteDir, true, uploader);

    const produced =
      nextStartNumber(
        await deps.listDir(dir).catch(() => []),
        getParts(archive.id, db).map((part) => part.part_index),
      ) > startNumber;

    // The bot stamps ended_at from the platform's offline signal — the
    // authoritative "the broadcast is over", as opposed to streamlink merely
    // losing the stream.
    const current = getArchive(archive.id, db);
    if (current?.ended_at) break;

    // On shutdown the remaining segments are still drained below, but no new
    // capture starts — the archive stays open for the next run to resume.
    if (deps.signal?.aborted) break;

    fruitlessRestarts = produced ? 0 : fruitlessRestarts + 1;
    if (fruitlessRestarts > MAX_FRUITLESS_RESTARTS) {
      logger.warn(
        `[Recorder] Giving up on ${archive.streamer_login}: capture produced nothing after ${MAX_FRUITLESS_RESTARTS} retries`,
      );
      break;
    }

    logger.info(
      `[Recorder] Capture for ${archive.streamer_login} ended but the stream is not marked offline; restarting`,
    );
    await deps.sleep(RESTART_DELAY_MS);
  }

  await finalize(archive.id, dir, remoteDir, uploader, deps);
}

// Last resort for a broadcast that was never captured live. Twitch only:
// Kick has no VOD API and no known deterministic CDN path scheme, so a Kick
// stream the recorder missed is simply gone.
async function tryRecover(
  archiveId: number,
  dir: string,
  remoteDir: string,
  uploader: UploaderDeps,
  deps: CaptureDeps,
): Promise<boolean> {
  const db = deps.db;
  const archive = getArchive(archiveId, db);
  if (!archive) return false;

  if (!env.ARCHIVE_RECOVERY_ENABLED || archive.platform !== "twitch") {
    return false;
  }

  const source = await deps.findRecoverySource(archive);
  if (!source) {
    logger.warn(
      `[Recorder] No recoverable VOD found for ${archive.streamer_login} broadcast ${archive.stream_id}`,
    );
    return false;
  }

  logger.info(`[Recorder] Recovering ${archive.streamer_login} from ${source}`);
  updateArchive(archiveId, { vod_m3u8: source }, db);

  const pipeline = deps.startCapture({
    url: source,
    platform: archive.platform,
    quality: env.ARCHIVE_QUALITY,
    outputDir: dir,
    segmentSeconds: env.ARCHIVE_SEGMENT_SECONDS,
    startNumber: 0,
  });

  let finished = false;
  const exited = pipeline.exited.then((code) => {
    finished = true;
    return code;
  });

  while (!finished) {
    await deps.sleep(DRAIN_INTERVAL_MS);
    if (finished) break;
    await drainClosedParts(archiveId, dir, remoteDir, false, uploader);
  }

  await exited;
  await drainClosedParts(archiveId, dir, remoteDir, true, uploader);

  if (countUploadedParts(archiveId, db) === 0) return false;

  updateArchive(archiveId, { status: "recovered", error: null }, db);
  logger.info(
    `[Recorder] Recovered ${archive.streamer_login} broadcast ${archive.stream_id}`,
  );
  return true;
}

async function finalize(
  archiveId: number,
  dir: string,
  remoteDir: string,
  uploader: UploaderDeps,
  deps: CaptureDeps,
): Promise<void> {
  const db = deps.db;
  updateArchive(archiveId, { status: "uploading" }, db);

  const result = await drainClosedParts(archiveId, dir, remoteDir, true, uploader);
  const parts = getParts(archiveId, db);
  const uploaded = parts.filter((part) => part.status === "uploaded");

  if (uploaded.length === 0) {
    // Nothing was captured live — the recorder was down, or the capture never
    // started. The published or freshly-deleted VOD is the only remaining
    // chance at this broadcast.
    if (await tryRecover(archiveId, dir, remoteDir, uploader, deps)) return;

    updateArchive(
      archiveId,
      {
        status: "failed",
        error: parts[0]?.error ?? "No segments were captured",
      },
      db,
    );
    return;
  }

  if (result.failed.length > 0 || uploaded.length < parts.length) {
    updateArchive(
      archiveId,
      {
        status: "failed",
        error: `${parts.length - uploaded.length} of ${parts.length} segments could not be uploaded`,
      },
      db,
    );
    return;
  }

  updateArchive(archiveId, { status: "done", error: null }, db);
  logger.info(
    `[Recorder] Archived ${uploaded.length} segments to ${remoteDir}`,
  );
}
