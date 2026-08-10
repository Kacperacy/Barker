import { Client } from "discord.js";
import { logger } from "../utils/logger";
import { env } from "../config";
import { getKickStreamsByCategory } from "./api";
import {
  getAllUniqueCategoryFilters,
  getGuildsForCategoryFilter,
} from "../database/repositories/categorySubscriptions";
import { hasIndividualSubscription } from "../database/repositories/subscriptions";
import { isStreamerBlacklisted } from "../database/repositories/blacklist";
import { getNotifiedStreamerLoginsForCategory } from "../database/repositories/liveAnnouncements";
import {
  clearStrikes,
  incrementStrikes,
} from "../database/repositories/categoryStrikes";
import {
  announceIfNewlyLive,
  retireLiveAnnouncements,
} from "../discord/liveTracking";

let isPolling = false;

export function startKickCategoryPolling(client: Client) {
  setInterval(async () => {
    if (isPolling) return;
    isPolling = true;

    try {
      const filters = getAllUniqueCategoryFilters("kick");

      for (const filter of filters) {
        const streams = await getKickStreamsByCategory(
          filter.category_id,
          filter.language,
        );
        const liveLogins = new Set(
          streams.map((s) => s.channel.slug.toLowerCase()),
        );

        for (const stream of streams) {
          const streamerLogin = stream.channel.slug.toLowerCase();
          clearStrikes(filter.category_id, streamerLogin, "kick");

          const subs = getGuildsForCategoryFilter(
            filter.category_id,
            filter.language,
            "kick",
          );

          for (const sub of subs) {
            if (
              hasIndividualSubscription(sub.guild_id, streamerLogin, "kick")
            ) {
              logger.info(
                `[Kick Category Polling] Skipping ${streamerLogin} for guild ${sub.guild_id} (Individual sub exists)`,
              );
              continue;
            }

            if (isStreamerBlacklisted(sub.guild_id, streamerLogin, "kick")) {
              logger.info(
                `[Kick Category Polling] Skipping ${streamerLogin} for guild ${sub.guild_id} (Blacklisted)`,
              );
              continue;
            }

            const announced = await announceIfNewlyLive({
              client,
              guildId: sub.guild_id,
              channelId: sub.channel_id,
              platform: "kick",
              streamerLogin,
              streamerName: stream.broadcaster_user.username,
              categoryId: filter.category_id,
              categoryName: stream.category.name,
              stream,
              customMessage: sub.custom_message,
              defaultTemplate: `@everyone A wild developer appeared! **{streamer}** is live in **{game}**!`,
            });

            if (announced) {
              logger.info(
                `[Kick Category Polling] Notification sent for ${streamerLogin} to channel ${sub.channel_id}`,
              );
            }
          }
        }

        const previouslyNotifiedLogins = getNotifiedStreamerLoginsForCategory(
          filter.category_id,
          "kick",
        );

        for (const streamerLogin of previouslyNotifiedLogins) {
          if (liveLogins.has(streamerLogin)) continue;

          const currentStrikes = incrementStrikes(
            filter.category_id,
            streamerLogin,
            "kick",
          );

          if (currentStrikes >= env.CATEGORY_MISSING_STRIKE_MAX) {
            await retireLiveAnnouncements({
              client,
              platform: "kick",
              streamerLogin,
              categoryId: filter.category_id,
            });
            clearStrikes(filter.category_id, streamerLogin, "kick");
            logger.info(
              `[Kick Category Polling] REMOVED STREAM DETECTED: ${streamerLogin} removed after ${env.CATEGORY_MISSING_STRIKE_MAX} missed polls in category ${filter.category_id}.`,
            );
          } else {
            logger.info(
              `[Kick Category Polling] Streamer ${streamerLogin} missing from category ${filter.category_id}. Strike ${currentStrikes}/${env.CATEGORY_MISSING_STRIKE_MAX}.`,
            );
          }
        }
      }
    } catch (error) {
      logger.error("Error during Kick category polling:", error);
    } finally {
      isPolling = false;
    }
  }, env.CATEGORY_POLL_INTERVAL_MS);
}
