import { Client } from "discord.js";
import { logger } from "../utils/logger";
import { twitchEvents } from "./eventsub";
import { getStreamData } from "./api";
import { getSubscriptionsForStreamer } from "../database/repositories/subscriptions";
import { announceIfNewlyLive, retireLiveAnnouncements } from "../discord/liveTracking";
import { clearLiveBroadcast, setLiveBroadcast } from "../chat/live";
import { recordStreamEnd, recordStreamStart } from "../archive/jobs";

export function setupTwitchHandlers(client: Client) {
  twitchEvents.on("streamOnline", async (eventData) => {
    const login = eventData.broadcaster_user_login.toLowerCase();
    logger.info(`EVENT TRIGGERED: ${login} went live!`);

    // Queued before the announcement delay below: every second waited is a
    // second of the broadcast that cannot be recovered later. The payload's
    // stream id and start time are also what a post-hoc VOD lookup needs.
    recordStreamStart({
      platform: "twitch",
      login,
      streamId: eventData.id,
      startedAt: eventData.started_at,
    });

    // Chat rows are stamped with the broadcast they were sent during, and this
    // go-live signal is the only thing that knows the stream id (see chat/live.ts):
    // the chat itself is read over anonymous IRC, which has no idea about it.
    setLiveBroadcast("twitch", login, {
      streamId: eventData.id,
      startedAt: eventData.started_at,
    });

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
    clearLiveBroadcast("twitch", login);

    recordStreamEnd("twitch", login);

    await retireLiveAnnouncements({
      client,
      platform: "twitch",
      streamerLogin: login,
      broadcasterName: eventData.broadcaster_user_name,
    });
  });
}
