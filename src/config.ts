import { z } from "zod";
import { logger } from "./utils/logger";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  TWITCH_CLIENT_ID: z.string().min(1),
  TWITCH_CLIENT_SECRET: z.string().min(1),
  TWITCH_REFRESH_TOKEN: z.string().min(1),
  RIOT_API_KEY: z.string().min(1),

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
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  logger.error(JSON.stringify(_env.error.format(), null, 2));
  process.exit(1);
}

export const env = _env.data;
