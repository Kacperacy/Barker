import { env } from "../config";
import { logger } from "../utils/logger";
import { fetchWithRetry } from "../utils/http";
import { getValidKickUserToken } from "./auth";
import { kickEventSubscriptionsResponseSchema } from "./schemas";

import { isChatLoggingEnabled } from "../chat/ingest";

const EVENTS_URL = "https://api.kick.com/public/v1/events/subscriptions";
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

// What a chat log needs from Kick. `livestream.status.updated` rides along
// because it is what tells the log which broadcast the messages belong to (and
// it is the same push channel the polling loop's comment claimed does not exist).
export const KICK_CHAT_EVENTS = [
  "chat.message.sent",
  "moderation.banned",
  "livestream.status.updated",
] as const;

interface ExistingSubscription {
  event: string;
}

async function listSubscriptions(token: string): Promise<ExistingSubscription[]> {
  const res = await fetchWithRetry(
    EVENTS_URL,
    { headers: { Authorization: `Bearer ${token}` } },
    { retries: 1, baseDelayMs: 500 },
  );
  if (!res.ok) {
    logger.error(`[Kick] could not list event subscriptions: ${res.status}`);
    return [];
  }

  const parsed = kickEventSubscriptionsResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    logger.error(
      `[Kick] unexpected event subscription list: ${parsed.error.message}`,
    );
    return [];
  }

  return (parsed.data.data ?? []).filter(
    (entry): entry is { event: string } => typeof entry.event === "string",
  );
}

// Webhooks are Kick's only transport, subscriptions are per app+channel, and an
// endpoint that keeps failing is unsubscribed automatically after a day — so this
// runs at startup and then periodically rather than once.
export async function ensureKickEventSubscriptions(): Promise<void> {
  if (!isChatLoggingEnabled()) return;

  const token = await getValidKickUserToken();
  if (!token) {
    logger.warn(
      "[Kick] no user token, so chat and bans will not be delivered. Run: bun run src/tools/authorize.ts kick",
    );
    return;
  }

  const existing = await listSubscriptions(token);
  const subscribed = new Set(existing.map((entry) => entry.event));
  const missing = KICK_CHAT_EVENTS.filter((event) => !subscribed.has(event));

  if (missing.length === 0) {
    logger.info(`[Kick] event subscriptions already in place (${existing.length})`);
    return;
  }

  const res = await fetchWithRetry(
    EVENTS_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      // With a user token Kick infers the broadcaster from the token, so the
      // channel cannot (and must not) be passed here.
      body: JSON.stringify({
        events: missing.map((name) => ({ name, version: 1 })),
        method: "webhook",
      }),
    },
    { retries: 1, baseDelayMs: 500 },
  );

  if (!res.ok) {
    logger.error(
      `[Kick] subscribing to chat events failed: ${res.status} ${await res.text()}`,
    );
    return;
  }

  const parsed = kickEventSubscriptionsResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    logger.error(
      `[Kick] unexpected subscription response: ${parsed.error.message}`,
    );
    return;
  }

  // Kick answers per event and can refuse one while accepting the others, so a
  // per-entry error is logged as itself instead of a blanket success.
  for (const entry of parsed.data.data ?? []) {
    if (entry.error) {
      logger.error(`[Kick] subscription ${entry.name ?? "?"} refused: ${entry.error}`);
    } else {
      logger.info(`[Kick] subscribed to ${entry.name ?? "?"} (${entry.subscription_id ?? "?"})`);
    }
  }
}

export function startKickEventSubscriptionRefresh(): void {
  void ensureKickEventSubscriptions();

  const timer = setInterval(() => {
    void ensureKickEventSubscriptions();
  }, REFRESH_INTERVAL_MS);

  timer.unref?.();
}
