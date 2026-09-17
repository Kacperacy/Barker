import { createHash, randomBytes } from "node:crypto";
import { env } from "../config";
import { logger } from "../utils/logger";
import {
  getConfig as getConfigDefault,
  setConfig as setConfigDefault,
} from "../database/repositories/config";
import { kickTokenResponseSchema } from "./schemas";

const TOKEN_KEY = "kick_app_token";
const TOKEN_EXPIRES_AT_KEY = "kick_app_token_expires_at";

// User token (authorization code). Chat, bans/timeouts and event subscriptions
// are all user-scoped: an app token can read public data but cannot subscribe to
// events, so this is the token the chat log runs on.
const USER_TOKEN_KEY = "kick_user_token";
const USER_REFRESH_TOKEN_KEY = "kick_user_refresh_token";
const USER_TOKEN_EXPIRES_AT_KEY = "kick_user_token_expires_at";

export const KICK_AUTHORIZE_URL = "https://id.kick.com/oauth/authorize";
export const KICK_TOKEN_URL = "https://id.kick.com/oauth/token";

// Requested at authorization time. `events:subscribe` is what chat logging needs
// (chat messages and moderation events both arrive as webhooks); the rest are
// deliberately absent — acting on chat from Discord would add `moderation:ban`,
// `moderation:chat_message:manage` and `chat:write`, and asking for them before
// that exists is asking for more access than the feature uses.
export const KICK_USER_SCOPES = ["events:subscribe"];

// Client-credentials tokens have no refresh token to rotate — expiry is
// just re-requested outright, so there's less state to manage than Twitch's
// user-token flow, but the same promise-dedup guard avoids concurrent
// refreshes racing each other under load.
let tokenRequestPromise: Promise<string> | null = null;

// getConfig/setConfig are injectable (defaulting to the real repository, the
// same pattern runMigrations(db = defaultDb) already uses) so tests can pass
// a plain in-memory fake instead of relying on module-mocking, which is
// fragile across bun versions/file load order for a module already imported
// elsewhere in the process.
export async function getValidAppToken(
  getConfig: (key: string) => string | null = getConfigDefault,
  setConfig: (key: string, value: string) => void = setConfigDefault,
): Promise<string> {
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

// ---------------------------------------------------------------- user token

export interface KickTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAtMs: number;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

// OAuth 2.1 requires PKCE for the authorization-code flow, so the tool generates
// a pair and hands the challenge to Kick; the verifier only ever travels in the
// token exchange. S256 is the only method Kick documents.
export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function kickAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
}): string {
  const url = new URL(KICK_AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", KICK_USER_SCOPES.join(" "));
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (input.state) url.searchParams.set("state", input.state);
  return url.toString();
}

export async function exchangeKickAuthorizationCode(input: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clientId?: string;
  clientSecret?: string;
  setConfig?: (key: string, value: string) => void;
}): Promise<KickTokenSet> {
  const setConfig = input.setConfig ?? setConfigDefault;

  const res = await fetch(KICK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: input.clientId ?? env.KICK_CLIENT_ID,
      client_secret: input.clientSecret ?? env.KICK_CLIENT_SECRET,
      redirect_uri: input.redirectUri,
      code: input.code,
      code_verifier: input.codeVerifier,
    }),
  });

  if (!res.ok) {
    throw new Error(`Kick code exchange failed: ${await res.text()}`);
  }

  return storeUserToken(kickTokenResponseSchema.parse(await res.json()), setConfig);
}

function storeUserToken(
  parsed: { access_token: string; refresh_token?: string; expires_in: number },
  setConfig: (key: string, value: string) => void,
): KickTokenSet {
  const expiresAtMs = Date.now() + parsed.expires_in * 1000;
  setConfig(USER_TOKEN_KEY, parsed.access_token);
  setConfig(USER_TOKEN_EXPIRES_AT_KEY, String(expiresAtMs));
  // Kick rotates refresh tokens; a response without one keeps the stored token
  // rather than clearing it and losing the grant.
  if (parsed.refresh_token) {
    setConfig(USER_REFRESH_TOKEN_KEY, parsed.refresh_token);
  }

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? null,
    expiresAtMs,
  };
}

export async function refreshKickUserToken(
  getConfig: (key: string) => string | null = getConfigDefault,
  setConfig: (key: string, value: string) => void = setConfigDefault,
): Promise<KickTokenSet | null> {
  const refreshToken = getConfig(USER_REFRESH_TOKEN_KEY);
  if (!refreshToken) return null;

  const res = await fetch(KICK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.KICK_CLIENT_ID,
      client_secret: env.KICK_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    logger.error(`Kick user token refresh failed: ${await res.text()}`);
    return null;
  }

  return storeUserToken(kickTokenResponseSchema.parse(await res.json()), setConfig);
}

// Returns null when the channel has never been authorized — the caller logs what
// to run (src/tools/authorize.ts) instead of throwing on every poll.
export async function getValidKickUserToken(
  getConfig: (key: string) => string | null = getConfigDefault,
  setConfig: (key: string, value: string) => void = setConfigDefault,
): Promise<string | null> {
  const token = getConfig(USER_TOKEN_KEY);
  const expiresAt = getConfig(USER_TOKEN_EXPIRES_AT_KEY);

  if (token && expiresAt && Date.now() < Number(expiresAt) - 60_000) {
    return token;
  }

  const refreshed = await refreshKickUserToken(getConfig, setConfig);
  return refreshed?.accessToken ?? null;
}
