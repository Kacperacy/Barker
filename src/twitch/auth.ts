import { env } from "../config";
import { logger } from "../utils/logger";
import { getConfig, setConfig } from "../database/repositories/config";

export async function getValidUserToken(): Promise<string> {
  let token = getConfig("twitch_user_token");

  if (token) {
    const check = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${token}` },
    });
    if (check.ok) return token;
  }

  logger.info("Twitch User Token expired. Refreshing...");
  const refreshToken =
    getConfig("twitch_refresh_token") || env.TWITCH_REFRESH_TOKEN;

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    logger.error(
      "CRITICAL: Failed to refresh Twitch token. You need a new TWITCH_REFRESH_TOKEN in .env!",
    );
    throw new Error("Token refresh failed");
  }

  const data = (await res.json()) as any;
  setConfig("twitch_user_token", data.access_token);
  setConfig("twitch_refresh_token", data.refresh_token);

  return data.access_token;
}
