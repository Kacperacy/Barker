import { z } from "zod";
import { logger } from "./utils/logger";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "Missing Discord token"),
  DISCORD_CLIENT_ID: z.string().min(1, "Missing Discord client ID"),
  TWITCH_CLIENT_ID: z.string().min(1, "Missing Twitch client ID"),
  TWITCH_CLIENT_SECRET: z.string().min(1, "Missing Twitch client secret"),
  TWITCH_REFRESH_TOKEN: z
    .string()
    .min(1, "Missing Twitch refresh token for EventSub"),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  logger.error("CONFIGURATION ERROR (.env):");
  logger.error(JSON.stringify(_env.error.format(), null, 2));
  process.exit(1);
}

export const env = _env.data;
