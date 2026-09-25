import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { z } from "zod";
import { env } from "../config";
import { db as defaultDb } from "../database/connection";
import { logger } from "../utils/logger";
import type { Platform } from "../types";
import { randomToken } from "./accounts";

// Logging in with Kick or Twitch. Both are the authorization-code flow run from
// this server (the client secret never reaches the browser), guarded by a
// single-use `state`. Kick also requires PKCE; Twitch does not document it, so
// it is not sent there. Only the identity is kept: the access token is used
// once to read who logged in, then dropped.

// An unfinished login older than this is refused.
const STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthProfile {
  platform: Platform;
  platformUserId: string;
  login: string;
  display: string | null;
  avatar: string | null;
}

function redirectUri(platform: Platform): string {
  return `${env.SITE_URL.replace(/\/$/, "")}/barker/auth/${platform}/callback`;
}

function challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// Only a same-site path may be returned to: "/vods", never another site.
// Browsers drop tabs and newlines from URLs and read "\\" as "/", so
// "/<TAB>/evil.test" or "/\\evil.test" would become "//evil.test" — a jump to
// another site. Only plain path characters are accepted.
const SAFE_PATH = /^\/(?![/\\])[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/;

export function safeReturnPath(raw: string | null): string {
  if (!raw || raw.length > 500 || !SAFE_PATH.test(raw)) return "/";
  return raw;
}

export function beginLogin(
  platform: Platform,
  returnTo: string | null,
  db: Database = defaultDb,
  now: Date = new Date(),
): string {
  const state = randomToken(24);
  const verifier = randomToken(48);
  db.query("DELETE FROM oauth_states WHERE created_at < ?1").run(
    new Date(now.getTime() - STATE_TTL_MS).toISOString(),
  );
  db.query(
    `INSERT INTO oauth_states (state, platform, code_verifier, return_to, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).run(state, platform, verifier, safeReturnPath(returnTo), now.toISOString());

  if (platform === "kick") {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: env.KICK_CLIENT_ID,
      redirect_uri: redirectUri("kick"),
      scope: "user:read",
      state,
      code_challenge: challenge(verifier),
      code_challenge_method: "S256",
    });
    return `https://id.kick.com/oauth/authorize?${params.toString()}`;
  }

  // `openid` grants nothing beyond identity; Twitch requires some scope, and
  // reading one's own Helix user needs no other.
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.TWITCH_CLIENT_ID,
    redirect_uri: redirectUri("twitch"),
    scope: "openid",
    state,
  });
  return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`;
}

// Consumes the state (single use) and returns what the login started with.
export function takeState(
  platform: Platform,
  state: string | null,
  db: Database = defaultDb,
  now: Date = new Date(),
): { verifier: string; returnTo: string } | null {
  if (!state) return null;
  const row = db
    .query("SELECT * FROM oauth_states WHERE state = ?1 AND platform = ?2")
    .get(state, platform) as
    | { code_verifier: string; return_to: string; created_at: string }
    | null;
  db.query("DELETE FROM oauth_states WHERE state = ?1").run(state);
  if (!row) return null;
  if (now.getTime() - Date.parse(row.created_at) > STATE_TTL_MS) return null;
  return { verifier: row.code_verifier, returnTo: row.return_to };
}

const tokenSchema = z.object({ access_token: z.string() });
const kickUsersSchema = z.object({
  data: z
    .array(
      z.object({
        user_id: z.number(),
        name: z.string(),
        profile_picture: z.string().nullish(),
      }),
    )
    .min(1),
});
const twitchUsersSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        login: z.string(),
        display_name: z.string().nullish(),
        profile_image_url: z.string().nullish(),
      }),
    )
    .min(1),
});

// Code → token → profile. Returns null on any failure (logged), so the callback
// can send the viewer back with an error instead of a stack trace.
export async function finishLogin(
  platform: Platform,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthProfile | null> {
  try {
    const tokenUrl =
      platform === "kick" ? "https://id.kick.com/oauth/token" : "https://id.twitch.tv/oauth2/token";
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: platform === "kick" ? env.KICK_CLIENT_ID : env.TWITCH_CLIENT_ID,
      client_secret: platform === "kick" ? env.KICK_CLIENT_SECRET : env.TWITCH_CLIENT_SECRET,
      redirect_uri: redirectUri(platform),
      code,
    });
    if (platform === "kick") body.set("code_verifier", verifier);
    const tokenRes = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!tokenRes.ok) {
      logger.error(`[Auth] ${platform} token exchange failed: ${tokenRes.status}`);
      return null;
    }
    const token = tokenSchema.parse(await tokenRes.json()).access_token;

    if (platform === "kick") {
      const res = await fetchImpl("https://api.kick.com/public/v1/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        logger.error(`[Auth] Kick profile lookup failed: ${res.status}`);
        return null;
      }
      const [user] = kickUsersSchema.parse(await res.json()).data;
      if (!user) return null;
      return {
        platform,
        platformUserId: String(user.user_id),
        // Kick addresses channels by slug: the display name with "_" as "-".
        login: user.name.toLowerCase().replace(/_/g, "-"),
        display: user.name,
        avatar: user.profile_picture ?? null,
      };
    }

    const res = await fetchImpl("https://api.twitch.tv/helix/users", {
      headers: { Authorization: `Bearer ${token}`, "Client-Id": env.TWITCH_CLIENT_ID },
    });
    if (!res.ok) {
      logger.error(`[Auth] Twitch profile lookup failed: ${res.status}`);
      return null;
    }
    const [user] = twitchUsersSchema.parse(await res.json()).data;
    if (!user) return null;
    return {
      platform,
      platformUserId: user.id,
      login: user.login,
      display: user.display_name ?? user.login,
      avatar: user.profile_image_url ?? null,
    };
  } catch (error) {
    logger.error(`[Auth] ${platform} login failed:`, error);
    return null;
  }
}
