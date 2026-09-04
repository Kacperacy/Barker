import { z } from "zod";
import { logger } from "./utils/logger";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  TWITCH_CLIENT_ID: z.string().min(1),
  TWITCH_CLIENT_SECRET: z.string().min(1),
  TWITCH_REFRESH_TOKEN: z.string().min(1),
  RIOT_API_KEY: z.string().min(1),
  KICK_CLIENT_ID: z.string().min(1),
  KICK_CLIENT_SECRET: z.string().min(1),

  RIOT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(120000),
  CATEGORY_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  SUMMARY_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  DAILY_SUMMARY_HOUR: z.coerce.number().int().min(0).max(23).default(6),
  DISCORD_QUEUE_DELAY_MS: z.coerce.number().int().nonnegative().default(1500),
  CATEGORY_MISSING_STRIKE_MAX: z.coerce.number().int().positive().default(10),
  DB_PATH: z.string().min(1).default("./db"),

  HTTP_RETRY_MAX_ATTEMPTS: z.coerce.number().int().nonnegative().default(3),
  HTTP_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(500),
  RIOT_RATE_LIMIT_PER_SECOND: z.coerce.number().int().positive().default(20),
  RIOT_RATE_LIMIT_PER_TWO_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(100),
  TWITCH_RATE_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .positive()
    .default(800),
  KICK_STREAMER_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60000),
  KICK_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),

  // VOD archiving. The bot only emits jobs; the recorder container consumes
  // them, so both processes read this same block.
  ARCHIVE_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  // "twitch:somestreamer,kick:some-slug" — see archive/targets.ts.
  ARCHIVE_STREAMERS: z.string().default(""),
  // streamlink stream selector; "best" is source quality. At ~3 GB/h that
  // fills a 2 TB Drive in about five months of daily four-hour streams —
  // "720p60" roughly halves it.
  ARCHIVE_QUALITY: z.string().min(1).default("best"),
  // Segment length. Shorter segments cap peak disk use, since each one is
  // uploaded and deleted while the stream is still running.
  ARCHIVE_SEGMENT_SECONDS: z.coerce.number().int().positive().default(3600),
  ARCHIVE_WORK_DIR: z.string().min(1).default("/data/recordings"),
  ARCHIVE_MAX_CONCURRENT: z.coerce.number().int().positive().default(1),
  // Refuse to start a capture below this much free space rather than filling
  // the host disk out from under the other containers.
  ARCHIVE_MIN_FREE_DISK_GB: z.coerce.number().int().positive().default(10),
  ARCHIVE_RCLONE_REMOTE: z.string().default("gdrive:Barker VODs"),
  ARCHIVE_RCLONE_CONFIG: z.string().default("/config/rclone/rclone.conf"),
  ARCHIVE_RECOVERY_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v === "true" || v === "1"),
  ARCHIVE_WEB_PORT: z.coerce.number().int().positive().default(3000),
  ARCHIVE_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  logger.error(JSON.stringify(_env.error.format(), null, 2));
  process.exit(1);
}

export const env = _env.data;
