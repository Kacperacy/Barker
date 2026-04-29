import { Client, TextChannel, EmbedBuilder } from "discord.js";
import {
  getAllUniqueStreamers,
  getSubscriptionsForStreamer,
  setConfig,
  getConfig,
  saveActiveMessage,
  getActiveMessages,
  clearActiveMessages,
} from "./database";
import { env } from "../config";
import { logger } from "../utils/logger";

let ws: WebSocket | null = null;
let sessionId: string = "";

async function getValidUserToken(): Promise<string> {
  let token = getConfig("twitch_user_token");

  if (token) {
    const check = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${token}` },
    });
    if (check.ok) return token;
  }

  logger.info("Twitch User Token expired. Refreshing...");
  const refreshToken =
    getConfig("twitch_refresh_token") || env.TWITCH_REFRESH_TOKEN;

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    logger.error(
      "CRITICAL: Failed to refresh Twitch token. You need a new TWITCH_REFRESH_TOKEN in .env!",
    );
    throw new Error("Token refresh failed");
  }

  const data = (await res.json()) as any;
  setConfig("twitch_user_token", data.access_token);
  setConfig("twitch_refresh_token", data.refresh_token);

  return data.access_token;
}

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

export async function subscribeToStreamer(login: string) {
  if (!sessionId) return;
  const broadcasterId = await getTwitchUserId(login);
  if (!broadcasterId) return logger.error(`Cannot find Twitch ID for ${login}`);

  const token = await getValidUserToken();

  const subscribeEvent = async (eventType: string) => {
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
  };

  await subscribeEvent("stream.online");
  await subscribeEvent("stream.offline");
}

async function getStreamData(login: string) {
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

export async function startTwitchMonitor(client: Client) {
  await getValidUserToken();

  ws = new WebSocket("wss://eventsub.wss.twitch.tv/ws");
  ws.onopen = () => logger.info("Connecting to Twitch EventSub WebSocket...");

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data.toString());
    const messageType = msg.metadata.message_type;

    if (messageType === "session_welcome") {
      sessionId = msg.payload.session.id;
      logger.info(`WebSocket Session established! ID: ${sessionId}`);

      const streamers = getAllUniqueStreamers();
      for (const login of streamers) {
        await subscribeToStreamer(login);
      }
    }

    if (messageType === "notification") {
      const eventType = msg.metadata.subscription_type;
      const eventData = msg.payload.event;
      const login = eventData.broadcaster_user_login.toLowerCase();

      if (eventType === "stream.online") {
        logger.info(`EVENT TRIGGERED: ${login} went live!`);

        setTimeout(async () => {
          const stream = await getStreamData(login);
          if (!stream) return;

          const subs = getSubscriptionsForStreamer(login);
          const embed = new EmbedBuilder()
            .setColor(0x9146ff)
            .setTitle(stream.title)
            .setURL(`https://twitch.tv/${login}`)
            .setAuthor({
              name: `${stream.user_name} is now live!`,
              iconURL:
                "https://cdn-icons-png.flaticon.com/512/5968/5968819.png",
            })
            .addFields(
              {
                name: "Game",
                value: stream.game_name || "No category",
                inline: true,
              },
              {
                name: "Viewers",
                value: stream.viewer_count.toString(),
                inline: true,
              },
            )
            .setImage(
              stream.thumbnail_url
                .replace("{width}", "1280")
                .replace("{height}", "720"),
            )
            .setTimestamp();

          for (const sub of subs) {
            try {
              const channel = (await client.channels.fetch(
                sub.channel_id,
              )) as TextChannel;
              if (channel) {
                let textContent = `@everyone Hey! **${stream.user_name}** just went live!`;
                if (sub.custom_message) {
                  textContent = sub.custom_message
                    .replace(/{streamer}/gi, stream.user_name)
                    .replace(/{game}/gi, stream.game_name || "something");
                }

                const sentMessage = await channel.send({
                  content: textContent,
                  embeds: [embed],
                });
                saveActiveMessage(login, channel.id, sentMessage.id);
              }
            } catch (err) {
              logger.error(
                `Could not send message to channel ${sub.channel_id}:`,
                err,
              );
            }
          }
        }, 5000);
      }

      if (eventType === "stream.offline") {
        logger.info(`EVENT TRIGGERED: ${login} went offline!`);

        const activeMessages = getActiveMessages(login);
        if (activeMessages.length === 0) return;

        const embedOffline = new EmbedBuilder()
          .setColor(0x808080)
          .setAuthor({
            name: `${eventData.broadcaster_user_name} was live`,
            iconURL: "https://cdn-icons-png.flaticon.com/512/5968/5968819.png",
          })
          .setTitle("Stream has ended")
          .setURL(`https://twitch.tv/${login}`)
          .setDescription("Catch them next time!")
          .setTimestamp();

        for (const msgData of activeMessages) {
          try {
            const channel = (await client.channels.fetch(
              msgData.channel_id,
            )) as TextChannel;
            if (channel) {
              const messageToEdit = await channel.messages.fetch(
                msgData.message_id,
              );
              if (messageToEdit) {
                await messageToEdit.edit({
                  content: `~~${eventData.broadcaster_user_name}~~ (Offline)`,
                  embeds: [embedOffline],
                });
              }
            }
          } catch (err) {
            logger.error(
              `Could not edit offline message in channel ${msgData.channel_id}:`,
              err,
            );
          }
        }

        clearActiveMessages(login);
      }
    }

    if (messageType === "session_reconnect") {
      logger.info("Twitch requested WebSocket reconnect. Adjusting...");
      ws?.close();
    }
  };

  ws.onerror = (error) => logger.error("WebSocket Error:", error);
  ws.onclose = () => {
    logger.info("WebSocket Closed. Attempting to reconnect in 5 seconds...");
    sessionId = "";
    setTimeout(() => startTwitchMonitor(client), 5000);
  };
}
