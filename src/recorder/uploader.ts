import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { env } from "../config";
import { logger } from "../utils/logger";
import {
  getParts,
  markPartStatus,
  recordPart,
  updateArchive,
  getArchive,
} from "../database/repositories/vodArchives";
import { buildRemoteName, closedPartIndices } from "./naming";

export interface UploaderDeps {
  db?: Database;
  listSegments: (dir: string) => Promise<string[]>;
  statSize: (path: string) => Promise<number>;
  upload: (localPath: string, remotePath: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
}

export interface DrainResult {
  uploaded: number[];
  failed: number[];
}

export function buildRcloneArgs(
  localPath: string,
  remotePath: string,
  configPath: string,
): string[] {
  return [
    "copyto",
    localPath,
    remotePath,
    "--config",
    configPath,
    "--retries",
    "3",
    "--low-level-retries",
    "10",
    "--drive-chunk-size",
    "64M",
    "--stats",
    "0",
  ];
}

export async function rcloneUpload(
  localPath: string,
  remotePath: string,
): Promise<void> {
  const proc = Bun.spawn(
    ["rclone", ...buildRcloneArgs(localPath, remotePath, env.ARCHIVE_RCLONE_CONFIG)],
    { stdout: "pipe", stderr: "pipe" },
  );

  const [code, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);

  if (code !== 0) {
    throw new Error(`rclone exited ${code}: ${stderr.trim()}`);
  }
}

export const defaultUploaderDeps: Omit<UploaderDeps, "db"> = {
  listSegments: (dir) => readdir(dir),
  statSize: async (path) => (await stat(path)).size,
  upload: rcloneUpload,
  remove: unlink,
};

// Uploads every segment ffmpeg has finished with, deleting each one locally as
// soon as it is safely remote. Called repeatedly while the capture runs, which
// is what keeps a multi-hour broadcast from ever occupying more than a segment
// or two of disk.
export async function drainClosedParts(
  archiveId: number,
  localDir: string,
  remoteDir: string,
  captureFinished: boolean,
  deps: UploaderDeps,
): Promise<DrainResult> {
  const db = deps.db;
  const filenames = await deps.listSegments(localDir);
  const closed = closedPartIndices(filenames, captureFinished);

  const alreadyUploaded = new Set(
    getParts(archiveId, db)
      .filter((part) => part.status === "uploaded")
      .map((part) => part.part_index),
  );

  const result: DrainResult = { uploaded: [], failed: [] };

  for (const index of closed) {
    if (alreadyUploaded.has(index)) continue;

    const name = buildRemoteName(index);
    const localPath = join(localDir, name);
    const remotePath = `${remoteDir}/${name}`;

    let bytes = 0;
    try {
      bytes = await deps.statSize(localPath);
    } catch {
      // The file vanished between listing and stat — a previous drain in the
      // same process already dealt with it.
      continue;
    }

    recordPart(archiveId, index, localPath, bytes, db);
    markPartStatus(archiveId, index, "uploading", {}, db);

    try {
      await deps.upload(localPath, remotePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The local file is deliberately left in place: it is the only copy,
      // and the next drain retries this index.
      markPartStatus(archiveId, index, "failed", { error: message }, db);
      logger.error(`[Recorder] Upload failed for ${remotePath}: ${message}`);
      result.failed.push(index);
      continue;
    }

    markPartStatus(archiveId, index, "uploaded", { remotePath }, db);

    try {
      await deps.remove(localPath);
    } catch (error) {
      logger.warn(`[Recorder] Could not delete ${localPath}: ${error}`);
    }

    const previous = getArchive(archiveId, db)?.bytes ?? 0;
    updateArchive(archiveId, { bytes: previous + bytes }, db);

    result.uploaded.push(index);
  }

  return result;
}
