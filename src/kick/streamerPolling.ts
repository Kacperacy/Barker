import { Client } from "discord.js";
import { logger } from "../utils/logger";
import { env } from "../config";
import { getKickBroadcasterId, getKickLivestreamsByBroadcasterIds } from "./api";
import {
  getAllUniqueStreamers,
  getSubscriptionsForStreamer,
} from "../database/repositories/subscriptions";
import {
  announceIfNewlyLive,
  retireLiveAnnouncements,
} from "../discord/liveTracking";

let isPolling = false;

// Kick has no EventSub-equivalent push channel, so individual-streamer
// tracking is polling-based here (unlike Twitch's WebSocket push in
// twitch/eventsub.ts). A direct by-broadcaster-id batch lookup has no
// pagination/discovery risk the way category listings do, so absence from
// the live batch is treated as offline immediately — no strike counter.
export function startKickStreamerPolling(client: Client) {
  setInterval(async () => {
    if (isPolling) return;
    isPolling = true;

    try {
      const trackedSlugs = getAllUniqueStreamers("kick");
      if (trackedSlugs.length === 0) return;

      const broadcasterIdBySlug = new Map<string, string>();
      for (const slug of trackedSlugs) {
        const id = await getKickBroadcasterId(slug);
        if (id) broadcasterIdBySlug.set(slug, id);
      }

      const liveStreams = await getKickLivestreamsByBroadcasterIds(
        Array.from(broadcasterIdBySlug.values()),
      );
      const streamBySlug = new Map(
        liveStreams.map((s) => [s.channel.slug.toLowerCase(), s]),
      );

      for (const slug of trackedSlugs) {
        const subs = getSubscriptionsForStreamer(slug, "kick");
        if (subs.length === 0) continue;

        const stream = streamBySlug.get(slug);

        if (stream) {
          for (const sub of subs) {
            const announced = await announceIfNewlyLive({
              client,
              guildId: sub.guild_id,
              channelId: sub.channel_id,
              platform: "kick",
              streamerLogin: slug,
              streamerName: stream.broadcaster_user.username,
              categoryName: stream.category?.name,
              stream,
              customMessage: sub.custom_message,
              defaultTemplate: `@everyone Hey! **{streamer}** just went live!`,
            });

            if (announced) {
              logger.info(
                `[Kick Polling] Notification sent for ${slug} to channel ${sub.channel_id}`,
              );
            }
          }
        } else {
          await retireLiveAnnouncements({
            client,
            platform: "kick",
            streamerLogin: slug,
          });
        }
      }
    } catch (error) {
      logger.error("[Kick Polling] Critical Error:", error);
    } finally {
      isPolling = false;
    }
  }, env.KICK_STREAMER_POLL_INTERVAL_MS);
}
