import { Client } from "discord.js";
import { logger } from "../utils/logger";
import { twitchEvents } from "./eventsub";
import { getStreamData } from "./api";
import { getSubscriptionsForStreamer } from "../database/repositories/subscriptions";
import { announceIfNewlyLive, retireLiveAnnouncements } from "../discord/liveTracking";

export function setupTwitchHandlers(client: Client) {
  twitchEvents.on("streamOnline", async (eventData) => {
    const login = eventData.broadcaster_user_login.toLowerCase();
    logger.info(`EVENT TRIGGERED: ${login} went live!`);

    setTimeout(async () => {
      const stream = await getStreamData(login);
      if (!stream) return;

      const subs = getSubscriptionsForStreamer(login, "twitch");
      if (subs.length === 0) return;

      for (const sub of subs) {
        const announced = await announceIfNewlyLive({
          client,
          guildId: sub.guild_id,
          channelId: sub.channel_id,
          platform: "twitch",
          streamerLogin: login,
          streamerName: stream.user_name,
          categoryName: stream.game_name,
          stream,
          customMessage: sub.custom_message,
          defaultTemplate: `@everyone Hey! **{streamer}** just went live!`,
        });

        if (!announced) {
          logger.info(
            `[EventSub] Skipped duplicate live announcement for ${login} in channel ${sub.channel_id}`,
          );
        }
      }
    }, 5000);
  });

  twitchEvents.on("streamOffline", async (eventData) => {
    const login = eventData.broadcaster_user_login.toLowerCase();
    logger.info(`EVENT TRIGGERED: ${login} went offline!`);

    await retireLiveAnnouncements({
      client,
      platform: "twitch",
      streamerLogin: login,
      broadcasterName: eventData.broadcaster_user_name,
    });
  });
}
