import { env } from "../config";
import { logger } from "../utils/logger";
import { getConfig, setConfig } from "../database/repositories/config";

let refreshTokenPromise: Promise<string> | null = null;

export async function getValidUserToken(): Promise<string> {
  const token = getConfig("twitch_user_token");

  if (token) {
    try {
      const check = await fetch("https://id.twitch.tv/oauth2/validate", {
        headers: { Authorization: `OAuth ${token}` },
      });
      if (check.ok) return token;
    } catch (e) {}
  }

  if (refreshTokenPromise) {
    return refreshTokenPromise;
  }

  logger.info("Twitch User Token expired. Refreshing...");

  refreshTokenPromise = (async () => {
    try {
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
        throw new Error(`Token refresh failed: ${await res.text()}`);
      }

      const data = (await res.json()) as any;
      setConfig("twitch_user_token", data.access_token);
      setConfig("twitch_refresh_token", data.refresh_token);

      return data.access_token;
    } finally {
      refreshTokenPromise = null;
    }
  })();

  return refreshTokenPromise;
}
