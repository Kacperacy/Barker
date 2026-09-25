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

  // Chat logging. Both platforms deliver chat only as it happens — Kick's public
  // API cannot read chat at all and Twitch publishes no message history — so
  // there is nothing to backfill from: switching this on starts the log here.
  CHAT_LOG_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  // "<platform>:<login>,…" — see chat/targets.ts.
  CHAT_LOG_CHANNELS: z.string().default(""),
  // Same format, for channels that are logged but must not be visible: the read
  // API leaves them out of its channel list and out of every unfiltered query,
  // so a dev/testing channel never reaches the site or its totals.
  // 0 keeps everything. Messages are the one table that grows with every viewer,
  // so a busy channel eventually wants a window.
  CHAT_LOG_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(0),
  // Stream history (streams/polling.ts): how often the logged channels are
  // checked for being live, which is also the viewer-graph resolution.
  STREAM_HISTORY_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(120000),

  // Read API and webhook receiver (src/web/server.ts). Kick delivers events by
  // webhook only, so this port has to be reachable from the internet through
  // whatever reverse proxy fronts the VPS.
  API_PORT: z.coerce.number().int().positive().default(3001),
  // Public base URL of this API, used to print the exact webhook path to register.
  PUBLIC_BASE_URL: z.string().default(""),

  // Site accounts and highlights (src/auth, src/highlights). The site reaches
  // Barker through its own /barker proxy, so login callbacks and the session
  // cookie live on the site's origin.
  SITE_URL: z.string().default("https://www.klaun.live"),
  // Origins allowed to send state-changing requests (login forms, marking).
  SITE_ORIGINS: z
    .string()
    .default("https://www.klaun.live,https://klaun.live,http://localhost:5173,http://localhost:4173,http://localhost:5199"),
  // "<platform>:<login>,…" — accounts with full control (roles, audit log).
  ADMIN_ACCOUNTS: z.string().default(""),
  // How far the live embed runs behind real time: a live mark is placed this
  // many seconds before the click.
  HIGHLIGHT_LIVE_DELAY_S: z.coerce.number().int().nonnegative().default(20),
  // Extra words a highlight note may not contain, comma-separated.
  HIGHLIGHT_BANNED_WORDS: z.string().default(""),
  // Optional. When set, the read endpoints require it (`Authorization: Bearer` or
  // `?token=`); empty leaves them public, which is how this chat is shown anyway.
  READ_API_TOKEN: z.string().default(""),
  // Optional pin for the Kick webhook signing key. Empty means it is fetched from
  // https://api.kick.com/public/v1/public-key and cached.
  KICK_WEBHOOK_PUBLIC_KEY: z.string().default(""),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  logger.error(JSON.stringify(_env.error.format(), null, 2));
  process.exit(1);
}

export const env = _env.data;
