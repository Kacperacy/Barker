import { env } from "../config";
import { logger } from "../utils/logger";
import { db } from "../database/connection";
import { runMigrations } from "../database/migrations";
import {
  claimNextArchive,
  listOpenArchives,
  updateArchive,
} from "../database/repositories/vodArchives";
import { defaultCaptureDeps, runArchive } from "./capture";
import { startWebServer } from "./web";

const shutdown = new AbortController();
const active = new Set<Promise<void>>();

// Rows left mid-flight by a killed container are not claimable — claiming
// only picks up 'pending'. Resetting them puts the normal path back in
// charge: still-live broadcasts resume capture, finished ones drain their
// leftover segments and close out.
function requeueInterruptedArchives() {
  const interrupted = listOpenArchives().filter(
    (archive) => archive.status !== "pending",
  );

  for (const archive of interrupted) {
    updateArchive(archive.id, { status: "pending" }, db);
    logger.info(
      `[Recorder] Requeued interrupted archive ${archive.id} (${archive.platform}/${archive.streamer_login})`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function workLoop() {
  while (!shutdown.signal.aborted) {
    if (active.size >= env.ARCHIVE_MAX_CONCURRENT) {
      await sleep(env.ARCHIVE_POLL_INTERVAL_MS);
      continue;
    }

    const archive = claimNextArchive();
    if (!archive) {
      await sleep(env.ARCHIVE_POLL_INTERVAL_MS);
      continue;
    }

    const task = runArchive(archive, {
      ...defaultCaptureDeps,
      signal: shutdown.signal,
    })
      .catch((error) => {
        logger.error(`[Recorder] Archive ${archive.id} failed:`, error);
        updateArchive(
          archive.id,
          {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          },
          db,
        );
      })
      .finally(() => {
        active.delete(task);
      });

    active.add(task);
  }
}

async function stop(signal: string): Promise<never> {
  logger.info(`[Recorder] Received ${signal}. Finishing current segments...`);
  shutdown.abort();

  try {
    // Captures stop at a segment boundary and their finished parts still get
    // uploaded, so a redeploy costs at most the segment in flight.
    await Promise.allSettled([...active]);
    db.close();
  } catch (error) {
    logger.error("[Recorder] Error during shutdown:", error);
  }

  logger.info("[Recorder] Shutdown complete.");
  process.exit(0);
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.error("[Recorder] Unhandled rejection:", reason);
});

if (!env.ARCHIVE_ENABLED) {
  logger.warn("[Recorder] ARCHIVE_ENABLED is not set. Idling.");
}

runMigrations();
requeueInterruptedArchives();
startWebServer();

logger.info(
  `[Recorder] Ready. Quality "${env.ARCHIVE_QUALITY}", ${env.ARCHIVE_SEGMENT_SECONDS}s segments, up to ${env.ARCHIVE_MAX_CONCURRENT} concurrent, uploading to ${env.ARCHIVE_RCLONE_REMOTE}`,
);

await workLoop();
