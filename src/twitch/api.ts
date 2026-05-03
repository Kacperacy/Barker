import { env } from "../config";
import { logger } from "../utils/logger";
import { getValidUserToken } from "./auth";
import { MemoryCache } from "../utils/cache";

const userIdCache = new MemoryCache<string>(24 * 60 * 60 * 1000);
const categoryIdCache = new MemoryCache<string>(24 * 60 * 60 * 1000);

export async function getTwitchUserId(login: string): Promise<string | null> {
  const normalizedLogin = login.toLowerCase();

  const cachedId = userIdCache.get(normalizedLogin);
  if (cachedId) return cachedId;

  const token = await getValidUserToken();
  const res = await fetch(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(normalizedLogin)}`,
    {
      headers: {
        "Client-ID": env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    },
  );
  const data = (await res.json()) as any;
  const id = data.data && data.data.length > 0 ? data.data[0].id : null;

  if (id) {
    userIdCache.set(normalizedLogin, id);
  }

  return id;
}

export async function getStreamData(login: string) {
  const token = await getValidUserToken();
  const res = await fetch(
    `https://api.twitch.tv/helix/streams?user_login=${login}`,
    {
      headers: {
        "Client-ID": env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    },
  );
  const data = (await res.json()) as any;
  return data.data && data.data.length > 0 ? data.data[0] : null;
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

  const token = await getValidUserToken();
  const res = await fetch(
    "https://api.twitch.tv/helix/eventsub/subscriptions",
    {
      method: "POST",
      headers: {
        "Client-ID": env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
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

  const token = await getValidUserToken();

  const res = await fetch(
    "https://api.twitch.tv/helix/eventsub/subscriptions?status=enabled",
    {
      headers: {
        "Client-ID": env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!res.ok) return;
  const data = (await res.json()) as any;

  const subsToDelete = data.data.filter(
    (sub: any) => sub.condition.broadcaster_user_id === broadcasterId,
  );

  for (const sub of subsToDelete) {
    await fetch(
      `https://api.twitch.tv/helix/eventsub/subscriptions?id=${sub.id}`,
      {
        method: "DELETE",
        headers: {
          "Client-ID": env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      },
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

  const token = await getValidUserToken();
  const res = await fetch(
    `https://api.twitch.tv/helix/games?name=${encodeURIComponent(name)}`,
    {
      headers: {
        "Client-ID": env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    },
  );
  const data = (await res.json()) as any;
  const id = data.data && data.data.length > 0 ? data.data[0].id : null;

  if (id) {
    categoryIdCache.set(normalizedName, id);
  }

  return id;
}

export async function getStreamsByCategory(
  categoryId: string,
  language: string,
) {
  const token = await getValidUserToken();
  let allStreams: any[] = [];
  let cursor: string | null = null;
  const baseUrl = `https://api.twitch.tv/helix/streams?game_id=${categoryId}&language=${language}&first=100`;

  do {
    const fetchUrl = cursor ? `${baseUrl}&after=${cursor}` : baseUrl;
    const res = await fetch(fetchUrl, {
      headers: {
        "Client-ID": env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    });
    const data = (await res.json()) as any;

    if (data.data) {
      allStreams = allStreams.concat(data.data);
    }

    cursor =
      data.pagination && data.pagination.cursor ? data.pagination.cursor : null;
  } while (cursor);

  return allStreams;
}
