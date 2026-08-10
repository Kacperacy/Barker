import { env } from "../config";
import { logger } from "../utils/logger";
import { getConfig, setConfig } from "../database/repositories/config";
import { kickTokenResponseSchema } from "./schemas";

const TOKEN_KEY = "kick_app_token";
const TOKEN_EXPIRES_AT_KEY = "kick_app_token_expires_at";

// Client-credentials tokens have no refresh token to rotate — expiry is
// just re-requested outright, so there's less state to manage than Twitch's
// user-token flow, but the same promise-dedup guard avoids concurrent
// refreshes racing each other under load.
let tokenRequestPromise: Promise<string> | null = null;

export async function getValidAppToken(): Promise<string> {
  const cachedToken = getConfig(TOKEN_KEY);
  const cachedExpiresAt = getConfig(TOKEN_EXPIRES_AT_KEY);

  if (cachedToken && cachedExpiresAt) {
    const expiresAtMs = Number(cachedExpiresAt);
    if (Date.now() < expiresAtMs - 60_000) {
      return cachedToken;
    }
  }

  if (tokenRequestPromise) {
    return tokenRequestPromise;
  }

  logger.info("Kick app token missing or expired. Requesting a new one...");

  tokenRequestPromise = (async () => {
    try {
      const res = await fetch("https://id.kick.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.KICK_CLIENT_ID,
          client_secret: env.KICK_CLIENT_SECRET,
          grant_type: "client_credentials",
        }),
      });

      if (!res.ok) {
        throw new Error(`Kick token request failed: ${await res.text()}`);
      }

      const parsed = kickTokenResponseSchema.parse(await res.json());
      const expiresAtMs = Date.now() + parsed.expires_in * 1000;

      setConfig(TOKEN_KEY, parsed.access_token);
      setConfig(TOKEN_EXPIRES_AT_KEY, String(expiresAtMs));

      return parsed.access_token;
    } finally {
      tokenRequestPromise = null;
    }
  })();

  return tokenRequestPromise;
}
