import type { z } from "zod";
import { env } from "../config";
import { logger } from "../utils/logger";
import { getValidAppToken } from "./auth";
import { MemoryCache } from "../utils/cache";
import { fetchWithRetry, RateLimiter } from "../utils/http";
import {
  kickCategoriesResponseSchema,
  kickCategoryLivestreamsResponseSchema,
  kickChannelsResponseSchema,
  kickLivestreamSchema,
  kickUserLivestreamsResponseSchema,
} from "./schemas";

export type KickLivestream = z.infer<typeof kickLivestreamSchema>;

const broadcasterIdCache = new MemoryCache<string>(24 * 60 * 60 * 1000);
const categoryCache = new MemoryCache<{ id: string; name: string }>(
  24 * 60 * 60 * 1000,
);

const kickRateLimiter = new RateLimiter([
  { maxRequests: env.KICK_RATE_LIMIT_PER_MINUTE, windowMs: 60000 },
]);

const MAX_BROADCASTER_IDS_PER_REQUEST = 100;

async function kickFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getValidAppToken();
  return fetchWithRetry(
    url,
    {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    },
    {
      retries: env.HTTP_RETRY_MAX_ATTEMPTS,
      baseDelayMs: env.HTTP_RETRY_BASE_DELAY_MS,
      rateLimiter: kickRateLimiter,
    },
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function getKickBroadcasterId(
  slug: string,
): Promise<string | null> {
  const normalizedSlug = slug.toLowerCase();

  const cachedId = broadcasterIdCache.get(normalizedSlug);
  if (cachedId) return cachedId;

  const res = await kickFetch(
    `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(normalizedSlug)}`,
  );
  if (!res.ok) {
    logger.error(
      `[Kick API] getKickBroadcasterId error: ${res.status} ${await res.text()}`,
    );
    return null;
  }

  const parsed = kickChannelsResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    logger.error(
      `[Kick API] getKickBroadcasterId: unexpected response shape: ${parsed.error.message}`,
    );
    return null;
  }

  const broadcasterUserId = parsed.data.data[0]?.broadcaster_user_id;
  if (broadcasterUserId === undefined) return null;

  const id = String(broadcasterUserId);
  broadcasterIdCache.set(normalizedSlug, id);
  return id;
}

export async function getKickCategoryId(
  name: string,
): Promise<{ id: string; name: string } | null> {
  const normalizedName = name.toLowerCase();

  const cached = categoryCache.get(normalizedName);
  if (cached) return cached;

  const res = await kickFetch(
    `https://api.kick.com/public/v2/categories?name=${encodeURIComponent(name)}`,
  );
  if (!res.ok) {
    logger.error(
      `[Kick API] getKickCategoryId error: ${res.status} ${await res.text()}`,
    );
    return null;
  }

  const parsed = kickCategoriesResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    logger.error(
      `[Kick API] getKickCategoryId: unexpected response shape: ${parsed.error.message}`,
    );
    return null;
  }

  const category = parsed.data.data[0];
  if (!category) return null;

  const result = { id: String(category.id), name: category.name };
  categoryCache.set(normalizedName, result);
  return result;
}

export async function getKickLivestreamsByBroadcasterIds(
  broadcasterIds: string[],
): Promise<KickLivestream[]> {
  if (broadcasterIds.length === 0) return [];

  const results: KickLivestream[] = [];

  for (const idsChunk of chunk(
    broadcasterIds,
    MAX_BROADCASTER_IDS_PER_REQUEST,
  )) {
    const params = new URLSearchParams();
    for (const id of idsChunk) params.append("user_id", id);

    const res = await kickFetch(
      `https://api.kick.com/public/v1/users/livestreams?${params.toString()}`,
    );
    if (!res.ok) {
      logger.error(
        `[Kick API] getKickLivestreamsByBroadcasterIds error: ${res.status} ${await res.text()}`,
      );
      continue;
    }

    const parsed = kickUserLivestreamsResponseSchema.safeParse(
      await res.json(),
    );
    if (!parsed.success) {
      logger.error(
        `[Kick API] getKickLivestreamsByBroadcasterIds: unexpected response shape: ${parsed.error.message}`,
      );
      continue;
    }

    results.push(...parsed.data.data);
  }

  return results;
}

export async function getKickStreamsByCategory(
  categoryId: string,
  languageCode: string,
): Promise<KickLivestream[]> {
  let allStreams: KickLivestream[] = [];
  let cursor: string | null = null;
  const baseUrl = `https://api.kick.com/public/v2/livestreams?category_id=${encodeURIComponent(categoryId)}&language_code=${encodeURIComponent(languageCode)}&limit=100`;

  do {
    const fetchUrl: string = cursor
      ? `${baseUrl}&cursor=${encodeURIComponent(cursor)}`
      : baseUrl;
    const res = await kickFetch(fetchUrl);
    if (!res.ok) {
      logger.error(
        `[Kick API] getKickStreamsByCategory error: ${res.status} ${await res.text()}`,
      );
      break;
    }

    const parsed = kickCategoryLivestreamsResponseSchema.safeParse(
      await res.json(),
    );
    if (!parsed.success) {
      logger.error(
        `[Kick API] getKickStreamsByCategory: unexpected response shape: ${parsed.error.message}`,
      );
      break;
    }

    allStreams = allStreams.concat(parsed.data.data);
    cursor = parsed.data.pagination?.next_cursor ?? null;
  } while (cursor);

  return allStreams;
}
