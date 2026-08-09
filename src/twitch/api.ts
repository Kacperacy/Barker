import type { z } from "zod";
import { env } from "../config";
import { logger } from "../utils/logger";
import { getValidUserToken } from "./auth";
import { MemoryCache } from "../utils/cache";
import { fetchWithRetry, RateLimiter } from "../utils/http";
import {
  eventSubSubscriptionsResponseSchema,
  twitchGamesResponseSchema,
  twitchStreamSchema,
  twitchStreamsResponseSchema,
  twitchUsersResponseSchema,
} from "./schemas";

type TwitchStream = z.infer<typeof twitchStreamSchema>;

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

  const res = await twitchFetch(
    "https://api.twitch.tv/helix/eventsub/subscriptions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: eventType,
        version: "1",
        condition: { broadcaster_user_id: broadcasterId },
        transport: { method: "websocket", session_id: sessionId },
      }),
    },
  );

  if (res.ok) logger.info(`Subscribed to ${eventType} for ${login}`);
  else
    logger.error(
      `Failed to subscribe to ${eventType} for ${login}: ${await res.text()}`,
    );
}

export async function unsubscribeFromStreamerEvents(login: string) {
  const broadcasterId = await getTwitchUserId(login);
  if (!broadcasterId) return;

  const res = await twitchFetch(
    "https://api.twitch.tv/helix/eventsub/subscriptions?status=enabled",
  );
  if (!res.ok) return;

  const parsed = eventSubSubscriptionsResponseSchema.safeParse(
    await res.json(),
  );
  if (!parsed.success) {
    logger.error(
      `[Twitch API] unsubscribeFromStreamerEvents: unexpected response shape: ${parsed.error.message}`,
    );
    return;
  }

  const subsToDelete = parsed.data.data.filter(
    (sub) => sub.condition.broadcaster_user_id === broadcasterId,
  );

  for (const sub of subsToDelete) {
    await twitchFetch(
      `https://api.twitch.tv/helix/eventsub/subscriptions?id=${sub.id}`,
      { method: "DELETE" },
    );
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
  const res = await twitchFetch(
    "https://api.twitch.tv/helix/eventsub/subscriptions?status=websocket_disconnected",
  );
  if (!res.ok) return;

  const parsed = eventSubSubscriptionsResponseSchema.safeParse(
    await res.json(),
  );
  if (!parsed.success) {
    logger.error(
      `[Twitch API] cleanupZombieSubscriptions: unexpected response shape: ${parsed.error.message}`,
    );
    return;
  }

  for (const sub of parsed.data.data) {
    await twitchFetch(
      `https://api.twitch.tv/helix/eventsub/subscriptions?id=${sub.id}`,
      { method: "DELETE" },
    );
    logger.info(`Cleaned up zombie subscription: ${sub.id}`);
  }
}
