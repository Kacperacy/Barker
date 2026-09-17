import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "../config";
import { logger } from "../utils/logger";
import { runMigrations } from "../database/migrations";
import { setConfig } from "../database/repositories/config";
import {
  createPkcePair,
  exchangeKickAuthorizationCode,
  kickAuthorizeUrl,
  KICK_USER_SCOPES,
} from "../kick/auth";
import { TWITCH_CHAT_SCOPES, validateTwitchToken } from "../twitch/api";

// One-off authorization helper.
//
// Barker never had a way to mint a user token — the stored one was produced by
// hand — and both platforms now need scopes that token does not carry (Twitch
// cannot add a scope by refreshing, and Kick had no user token at all). This
// walks each flow once and writes the result into the config table, which is
// where the bot reads its tokens from.
//
//   bun run src/tools/authorize.ts twitch
//   bun run src/tools/authorize.ts kick

const TWITCH_AUTHORIZE_URL = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";

const twitchTokenResponseSchema = z
  .object({
    access_token: z.string(),
    refresh_token: z.string().optional(),
    // Twitch returns the granted scopes here (as a list, or a space-delimited
    // string on older flows), which is how this reports what was actually
    // authorized rather than what was asked for.
    scope: z.union([z.array(z.string()), z.string()]).optional(),
  })
  .passthrough();

function ask(question: string): string {
  const answer = prompt(question);
  if (answer === null) {
    logger.error("No input available — run this command in a terminal.");
    process.exit(1);
  }
  return answer.trim();
}

// Accepts either the full redirect URL or a bare code, because both are what
// people end up with depending on how the app's redirect URI is configured.
function extractCode(input: string): string {
  if (input.startsWith("http")) {
    const code = new URL(input).searchParams.get("code");
    if (code) return code;
  }
  const match = /[?&]?code=([^&]+)/.exec(input);
  return match?.[1] ?? input;
}

async function authorizeTwitch(): Promise<void> {
  const url = new URL(TWITCH_AUTHORIZE_URL);
  url.searchParams.set("client_id", env.TWITCH_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.TWITCH_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", TWITCH_CHAT_SCOPES.join(" "));

  console.log("\n1. Open this URL and authorize as the channel's own account:\n");
  console.log(url.toString());
  console.log(
    `\n2. You will land on ${env.TWITCH_REDIRECT_URI} — paste the whole URL back here.`,
  );

  const code = extractCode(ask("\nRedirect URL or code: "));
  if (!code) {
    logger.error("No code given.");
    process.exit(1);
  }

  const res = await fetch(TWITCH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: env.TWITCH_REDIRECT_URI,
    }),
  });

  if (!res.ok) {
    logger.error(`Token exchange failed: ${await res.text()}`);
    process.exit(1);
  }

  const parsed = twitchTokenResponseSchema.safeParse(await res.json());

  if (!parsed.success) {
    logger.error(`Unexpected token response: ${parsed.error.message}`);
    process.exit(1);
  }

  setConfig("twitch_user_token", parsed.data.access_token);
  if (parsed.data.refresh_token) {
    setConfig("twitch_refresh_token", parsed.data.refresh_token);
  }

  const check = await validateTwitchToken();
  logger.info(
    `Twitch authorized for ${check?.login ?? "?"}. Scopes now on the token: ${
      check?.scopes.join(", ") ?? "(unknown)"
    }`,
  );
}

async function authorizeKick(): Promise<void> {
  if (!env.KICK_REDIRECT_URI) {
    logger.error(
      "Set KICK_REDIRECT_URI first (it has to match a redirect URI registered on the Kick app).",
    );
    process.exit(1);
  }

  // OAuth 2.1: the verifier stays in this process, only its S256 hash is sent.
  const { verifier, challenge } = createPkcePair();

  const url = kickAuthorizeUrl({
    clientId: env.KICK_CLIENT_ID,
    redirectUri: env.KICK_REDIRECT_URI,
    codeChallenge: challenge,
    state: randomUUID(),
  });

  console.log(
    `\n1. Open this URL and authorize as the channel's own account (scopes: ${KICK_USER_SCOPES.join(", ")}):\n`,
  );
  console.log(url.toString());
  console.log(
    `\n2. You will land on ${env.KICK_REDIRECT_URI} — paste the whole URL back here.`,
  );

  const code = extractCode(ask("\nRedirect URL or code: "));
  if (!code) {
    logger.error("No code given.");
    process.exit(1);
  }

  const tokens = await exchangeKickAuthorizationCode({
    code,
    redirectUri: env.KICK_REDIRECT_URI,
    codeVerifier: verifier,
  });

  logger.info(
    `Kick authorized. Access token valid for ${Math.round(
      (tokens.expiresAtMs - Date.now()) / 60_000,
    )} minute(s); the refresh token was stored so the bot renews it by itself.`,
  );
}

const platform = process.argv[2];

runMigrations();

if (platform === "twitch") {
  await authorizeTwitch();
} else if (platform === "kick") {
  await authorizeKick();
} else {
  console.log("Usage: bun run src/tools/authorize.ts <twitch|kick>");
  process.exit(1);
}

console.log("\nDone. Restart the bot so the new token is picked up.");
process.exit(0);
