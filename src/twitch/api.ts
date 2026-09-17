import type { z } from "zod";
import { env } from "../config";
import { logger } from "../utils/logger";
import { getValidUserToken } from "./auth";
import { MemoryCache } from "../utils/cache";
import { fetchWithRetry, RateLimiter } from "../utils/http";
import {
  eventSubSubscriptionSchema,
  eventSubSubscriptionsResponseSchema,
  twitchGamesResponseSchema,
  twitchStreamSchema,
  twitchStreamsResponseSchema,
  twitchUsersResponseSchema,
} from "./schemas";

type TwitchStream = z.infer<typeof twitchStreamSchema>;
export type EventSubSubscription = z.infer<typeof eventSubSubscriptionSchema>;

const EVENTSUB_SUBSCRIPTIONS_URL =
  "https://api.twitch.tv/helix/eventsub/subscriptions";

const userIdCache = new MemoryCache<string>(24 * 60 * 60 * 1000);
const categoryIdCache = new MemoryCache<string>(24 * 60 * 60 * 1000);

const twitchRateLimiter = new RateLimiter([
  { maxRequests: env.TWITCH_RATE_LIMIT_PER_MINUTE, windowMs: 60000 },
]);

async function twitchFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getValidUserToken();
  return fetchWithRetry(
    url,
    {
      ...init,
      headers: {
        ...init.headers,
        "Client-ID": env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    },
    {
      retries: env.HTTP_RETRY_MAX_ATTEMPTS,
      baseDelayMs: env.HTTP_RETRY_BASE_DELAY_MS,
      rateLimiter: twitchRateLimiter,
    },
  );
}

export async function getTwitchUserId(login: string): Promise<string | null> {
  const normalizedLogin = login.toLowerCase();

  const cachedId = userIdCache.get(normalizedLogin);
  if (cachedId) return cachedId;

  const res = await twitchFetch(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(normalizedLogin)}`,
  );
  if (!res.ok) {
    logger.error(
      `[Twitch API] getTwitchUserId error: ${res.status} ${await res.text()}`,
    );
    return null;
  }

  const parsed = twitchUsersResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    logger.error(
      `[Twitch API] getTwitchUserId: unexpected response shape: ${parsed.error.message}`,
    );
    return null;
  }

  const id = parsed.data.data[0]?.id ?? null;
  if (id) userIdCache.set(normalizedLogin, id);
  return id;
}

export async function getStreamData(
  login: string,
): Promise<TwitchStream | null> {
  const res = await twitchFetch(
    `https://api.twitch.tv/helix/streams?user_login=${login}`,
  );
  if (!res.ok) {
    logger.error(
      `[Twitch API] getStreamData error: ${res.status} ${await res.text()}`,
    );
    return null;
  }

  const parsed = twitchStreamsResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    logger.error(
      `[Twitch API] getStreamData: unexpected response shape: ${parsed.error.message}`,
    );
    return null;
  }

  return parsed.data.data[0] ?? null;
}

// Twitch keys subscription uniqueness on type + condition per client ID, so
// a subscription left behind by a dead session blocks its own replacement
// with a 409 — the streamer would stay bound to a session that will never
// deliver events again.
export function isZombieSubscription(sub: { status: string }): boolean {
  return sub.status !== "enabled";
}

export function planConflictResolution(
  existing: { status: string; transport: { session_id?: string } } | null,
  sessionId: string,
): "keep" | "replace" | "create" {
  if (!existing) return "create";
  if (
    existing.status === "enabled" &&
    existing.transport.session_id === sessionId
  )
    return "keep";
  return "replace";
}

// Walks every page: a single page caps at 100, and a bot tracking more
// streamers than that would silently never see the rest.
async function listEventSubSubscriptions(): Promise<EventSubSubscription[]> {
  const all: EventSubSubscription[] = [];
  let cursor: string | null = null;

  do {
    const res = await twitchFetch(
      cursor
        ? `${EVENTSUB_SUBSCRIPTIONS_URL}?after=${cursor}`
        : EVENTSUB_SUBSCRIPTIONS_URL,
    );
    if (!res.ok) {
      logger.error(
        `[Twitch API] listEventSubSubscriptions error: ${res.status} ${await res.text()}`,
      );
      break;
    }

    const parsed = eventSubSubscriptionsResponseSchema.safeParse(
      await res.json(),
    );
    if (!parsed.success) {
      logger.error(
        `[Twitch API] listEventSubSubscriptions: unexpected response shape: ${parsed.error.message}`,
      );
      break;
    }

    all.push(...parsed.data.data);
    cursor = parsed.data.pagination?.cursor ?? null;
  } while (cursor);

  return all;
}

async function deleteSubscription(id: string): Promise<void> {
  await twitchFetch(`${EVENTSUB_SUBSCRIPTIONS_URL}?id=${id}`, {
    method: "DELETE",
  });
}

function createSubscription(
  eventType: string,
  broadcasterId: string,
  sessionId: string,
): Promise<Response> {
  return twitchFetch(EVENTSUB_SUBSCRIPTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: eventType,
      version: "1",
      condition: { broadcaster_user_id: broadcasterId },
      transport: { method: "websocket", session_id: sessionId },
    }),
  });
}

export async function subscribeToEvent(
  login: string,
  eventType: string,
  sessionId: string,
) {
  const broadcasterId = await getTwitchUserId(login);
  if (!broadcasterId) {
    logger.error(`Cannot find Twitch ID for ${login}`);
    return;
  }

  let res = await createSubscription(eventType, broadcasterId, sessionId);

  if (res.status === 409) {
    const existing =
      (await listEventSubSubscriptions()).find(
        (sub) =>
          sub.type === eventType &&
          sub.condition.broadcaster_user_id === broadcasterId,
      ) ?? null;

    const plan = planConflictResolution(existing, sessionId);

    if (plan === "keep") {
      logger.info(
        `Already subscribed to ${eventType} for ${login} on this session`,
      );
      return;
    }

    if (plan === "replace" && existing) {
      logger.info(
        `Replacing stale ${eventType} subscription for ${login} (status: ${existing.status})`,
      );
      await deleteSubscription(existing.id);
    }

    res = await createSubscription(eventType, broadcasterId, sessionId);
  }

  if (res.ok) logger.info(`Subscribed to ${eventType} for ${login}`);
  else
    logger.error(
      `Failed to subscribe to ${eventType} for ${login}: ${await res.text()}`,
    );
}

export async function unsubscribeFromStreamerEvents(login: string) {
  const broadcasterId = await getTwitchUserId(login);
  if (!broadcasterId) return;

  const subsToDelete = (await listEventSubSubscriptions()).filter(
    (sub) => sub.condition.broadcaster_user_id === broadcasterId,
  );

  for (const sub of subsToDelete) {
    await deleteSubscription(sub.id);
    logger.info(
      `Unsubscribed from event ${sub.type} for ${login} in Twitch API`,
    );
  }
}

export async function getTwitchCategoryId(
  name: string,
): Promise<string | null> {
  const normalizedName = name.toLowerCase();

  const cachedId = categoryIdCache.get(normalizedName);
  if (cachedId) return cachedId;

  const res = await twitchFetch(
    `https://api.twitch.tv/helix/games?name=${encodeURIComponent(name)}`,
  );
  if (!res.ok) {
    logger.error(
      `[Twitch API] getTwitchCategoryId error: ${res.status} ${await res.text()}`,
    );
    return null;
  }

  const parsed = twitchGamesResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    logger.error(
      `[Twitch API] getTwitchCategoryId: unexpected response shape: ${parsed.error.message}`,
    );
    return null;
  }

  const id = parsed.data.data[0]?.id ?? null;
  if (id) categoryIdCache.set(normalizedName, id);
  return id;
}

export async function getStreamsByCategory(
  categoryId: string,
  language: string,
): Promise<TwitchStream[]> {
  let allStreams: TwitchStream[] = [];
  let cursor: string | null = null;
  const baseUrl = `https://api.twitch.tv/helix/streams?game_id=${categoryId}&language=${language}&first=100`;

  do {
    const fetchUrl: string = cursor ? `${baseUrl}&after=${cursor}` : baseUrl;
    const res = await twitchFetch(fetchUrl);
    if (!res.ok) {
      logger.error(
        `[Twitch API] getStreamsByCategory error: ${res.status} ${await res.text()}`,
      );
      break;
    }

    const parsed = twitchStreamsResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      logger.error(
        `[Twitch API] getStreamsByCategory: unexpected response shape: ${parsed.error.message}`,
      );
      break;
    }

    const validStreams = parsed.data.data.filter(
      (stream) =>
        stream.game_id === categoryId && stream.language === language,
    );
    allStreams = allStreams.concat(validStreams);

    cursor = parsed.data.pagination?.cursor ?? null;
  } while (cursor);

  return allStreams;
}

export async function cleanupZombieSubscriptions() {
  const zombies = (await listEventSubSubscriptions()).filter(
    isZombieSubscription,
  );

  for (const sub of zombies) {
    await deleteSubscription(sub.id);
    logger.info(
      `Cleaned up zombie subscription: ${sub.id} (status: ${sub.status})`,
    );
  }
}
