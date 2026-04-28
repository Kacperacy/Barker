import { z } from "zod";

// Define required environment variables and their types
const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "Missing Discord token"),
  DISCORD_CLIENT_ID: z.string().min(1, "Missing Discord client ID"),
  TWITCH_CLIENT_ID: z.string().min(1, "Missing Twitch client ID"),
  TWITCH_CLIENT_SECRET: z.string().min(1, "Missing Twitch client secret"),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error("CONFIGURATION ERROR (.env):");
  console.error(_env.error.format());
  process.exit(1);
}

export const env = _env.data;
