import { Client, TextChannel, EmbedBuilder } from "discord.js";
import { getAllUniqueStreamers, getChannelsForStreamer } from "./database";
import { env } from "../config";
import { logger } from "../utils/logger";

const liveStreamers = new Set<string>();
let twitchAccessToken = "";

async function getTwitchToken() {
  const params = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: "client_credentials",
  });
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body: params,
  });
  const data = (await res.json()) as any;
  return data.access_token;
}

async function getStreamsData(streamers: string[]) {
  if (streamers.length === 0) return [];

  const queryParams = streamers
    .map((s) => `user_login=${encodeURIComponent(s)}`)
    .join("&");

  const res = await fetch(
    `https://api.twitch.tv/helix/streams?${queryParams}`,
    {
      headers: {
        "Client-ID": env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${twitchAccessToken}`,
      },
    },
  );

  if (!res.ok) {
    if (res.status === 401) twitchAccessToken = await getTwitchToken(); // Refresh token if expired
    return [];
  }

  const data = (await res.json()) as any;
  return data.data || [];
}

export async function startTwitchMonitor(client: Client) {
  twitchAccessToken = await getTwitchToken();
  logger.info("Connected to Twitch API");

  const checkTwitchStreams = async () => {
    try {
      const streamersToCheck = getAllUniqueStreamers();
      if (streamersToCheck.length === 0) return;

      const streams = await getStreamsData(streamersToCheck);

      const currentLiveLogins = new Set(
        streams.map((s: any) => s.user_login.toLowerCase()),
      );

      for (const stream of streams) {
        const login = stream.user_login.toLowerCase();

        if (!liveStreamers.has(login)) {
          liveStreamers.add(login);

          const channelIds = getChannelsForStreamer(login);

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

          for (const channelId of channelIds) {
            try {
              const channel = (await client.channels.fetch(
                channelId,
              )) as TextChannel;
              if (channel) {
                await channel.send({
                  content: `@everyone 🚀 Hey! **${stream.user_name}** just went live!`,
                  embeds: [embed],
                });
              }
            } catch (err) {
              logger.error(
                `Could not send message to channel ${channelId}:`,
                err,
              );
            }
          }
        }
      }

      for (const login of liveStreamers) {
        if (!currentLiveLogins.has(login)) {
          liveStreamers.delete(login);
        }
      }
    } catch (e) {
      logger.error("Twitch monitor error:", e);
    }
  };

  await checkTwitchStreams();

  setInterval(checkTwitchStreams, 180_000);
}
