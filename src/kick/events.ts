import { logger } from "../utils/logger";
import { fetchWithRetry } from "../utils/http";
import { getValidAppToken } from "./auth";
import { getKickBroadcasterId } from "./api";
import { chatLogTargets, isChatLoggingEnabled } from "../chat/ingest";
import { kickEventSubscriptionsResponseSchema } from "./schemas";

const EVENTS_URL = "https://api.kick.com/public/v1/events/subscriptions";
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

// What a chat log needs from Kick. `livestream.status.updated` rides along
// because it is what tells the log which broadcast a message belongs to.
export const KICK_CHAT_EVENTS = [
  "chat.message.sent",
  "moderation.banned",
  "livestream.status.updated",
] as const;

interface ExistingSubscription {
  event: string;
  broadcasterUserId: number | null;
  method: string | null;
}

function kickChatChannels(): string[] {
  return chatLogTargets()
    .filter((target) => target.platform === "kick")
    .map((target) => target.login);
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

  return (parsed.data.data ?? [])
    .map((entry) => ({
      event: entry.event ?? entry.name ?? "",
      broadcasterUserId: entry.broadcaster_user_id ?? null,
      method: entry.method ?? null,
    }))
    .filter((entry) => entry.event !== "");
}

// Subscribes the **app** to another channel's chat.
//
// Kick documents exactly this: with a user token the broadcaster is inferred from
// the token, while "when using an app access token, this field is required" — and
// an app token is the only credential a third party can have, since nobody outside
// the channel can authorize as its owner. The endpoint's authorization block still
// lists a user token, so if Kick refuses an app token here the refusal is logged
// per event instead of being swallowed.
export async function ensureKickEventSubscriptions(): Promise<void> {
  if (!isChatLoggingEnabled()) return;

  const channels = kickChatChannels();
  if (channels.length === 0) return;

  const token = await getValidAppToken();
  const subscribed = await listSubscriptions(token);

  for (const slug of channels) {
    const broadcasterId = await getKickBroadcasterId(slug);
    if (!broadcasterId) {
      logger.error(
        `[Kick] cannot resolve the broadcaster id for ${slug}; chat will not arrive for it`,
      );
      continue;
    }

    const have = new Set(
      subscribed
        .filter(
          (entry) =>
            String(entry.broadcasterUserId ?? "") === broadcasterId &&
            (entry.method === null || entry.method === "webhook"),
        )
        .map((entry) => entry.event),
    );
    const missing = KICK_CHAT_EVENTS.filter((event) => !have.has(event));
    if (missing.length === 0) continue;

    const res = await fetchWithRetry(
      EVENTS_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          broadcaster_user_id: Number(broadcasterId),
          events: missing.map((name) => ({ name, version: 1 })),
          method: "webhook",
        }),
      },
      { retries: 1, baseDelayMs: 500 },
    );

    if (!res.ok) {
      logger.error(
        `[Kick] subscribing to chat events for ${slug} failed: ${res.status} ${await res.text()}`,
      );
      continue;
    }

    const parsed = kickEventSubscriptionsResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      logger.error(
        `[Kick] unexpected subscription response for ${slug}: ${parsed.error.message}`,
      );
      continue;
    }

    // Kick answers per event and can refuse one while accepting the others.
    for (const entry of parsed.data.data ?? []) {
      const name = entry.name ?? entry.event ?? "?";
      if (entry.error) {
        logger.error(`[Kick] subscription ${name} for ${slug} refused: ${entry.error}`);
      } else {
        logger.info(
          `[Kick] subscribed to ${name} for ${slug} (${entry.subscription_id ?? entry.id ?? "?"})`,
        );
      }
    }
  }
}

// Kick unsubscribes an endpoint that keeps failing for a day, so this is re-checked
// rather than done once.
export function startKickEventSubscriptionRefresh(): void {
  void ensureKickEventSubscriptions();

  const timer = setInterval(() => {
    void ensureKickEventSubscriptions();
  }, REFRESH_INTERVAL_MS);

  timer.unref?.();
}
