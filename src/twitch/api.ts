import { env } from "../config";
import { logger } from "../utils/logger";
import { getValidUserToken } from "./auth";

export async function getTwitchUserId(login: string): Promise<string | null> {
  const token = await getValidUserToken();
  const res = await fetch(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`,
    {
      headers: {
        "Client-ID": env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    },
  );
  const data = (await res.json()) as any;
  return data.data && data.data.length > 0 ? data.data[0].id : null;
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
