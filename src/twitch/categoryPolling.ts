import { Client } from "discord.js";
import { logger } from "../utils/logger";
import { getStreamsByCategory } from "./api";
import {
  getAllUniqueCategoryFilters,
  getGuildsForCategoryFilter,
  isUserNotified,
  addNotifiedUser,
  getNotifiedUsersForCategory,
  removeNotifiedUser,
} from "../database/repositories/categorySubscriptions";
import { hasIndividualSubscription } from "../database/repositories/subscriptions";
import { isStreamerBlacklisted } from "../database/repositories/blacklist";
import { sendStreamNotification } from "../discord/notifier";

const missingStrikes = new Map<string, number>();
const MAX_STRIKES = 10;
let isPolling = false;

export function startCategoryPolling(client: Client) {
  setInterval(async () => {
    if (isPolling) return;
    isPolling = true;

    try {
      const filters = getAllUniqueCategoryFilters();

      for (const filter of filters) {
        const streams = await getStreamsByCategory(
          filter.category_id,
          filter.language,
        );
        const liveUserIds = new Set(streams.map((s: any) => s.user_id));

        for (const stream of streams) {
          const strikeKey = `${filter.category_id}_${stream.user_id}`;
          if (missingStrikes.has(strikeKey)) {
            missingStrikes.delete(strikeKey);
          }

          if (!isUserNotified(stream.user_id, filter.category_id)) {
            logger.info(
              `[Category Polling] NEW STREAM DETECTED: ${stream.user_login} in category ${filter.category_id}`,
            );

            const subs = getGuildsForCategoryFilter(
              filter.category_id,
              filter.language,
            );

            for (const sub of subs) {
              const streamerLogin = stream.user_login.toLowerCase();

              if (hasIndividualSubscription(sub.guild_id, streamerLogin)) {
                logger.info(
                  `[Category Polling] Skipping ${streamerLogin} for guild ${sub.guild_id} (Individual sub exists)`,
                );
                continue;
              }

              if (isStreamerBlacklisted(sub.guild_id, streamerLogin)) {
                logger.info(
                  `[Category Polling] Skipping ${streamerLogin} for guild ${sub.guild_id} (Blacklisted)`,
                );
                continue;
              }

              const messageId = await sendStreamNotification(
                client,
                sub.channel_id,
                stream,
                sub.custom_message,
                `@everyone A wild developer appeared! **{streamer}** is live in **{game}**!`,
              );

              if (messageId) {
                logger.info(
                  `[Category Polling] Notification sent for ${streamerLogin} to channel ${sub.channel_id}`,
                );
              }
            }

            addNotifiedUser(stream.user_id, filter.category_id);
            logger.info(
              `[Category Polling] Added ${stream.user_login} (${stream.user_id}) to notified list for category ${filter.category_id}`,
            );
          }
        }

        const previouslyNotified = getNotifiedUsersForCategory(
          filter.category_id,
        );
        for (const user of previouslyNotified) {
          if (!liveUserIds.has(user.user_id)) {
            const strikeKey = `${filter.category_id}_${user.user_id}`;
            const currentStrikes = (missingStrikes.get(strikeKey) || 0) + 1;

            if (currentStrikes >= MAX_STRIKES) {
              removeNotifiedUser(user.user_id, filter.category_id);
              missingStrikes.delete(strikeKey);
              logger.info(
                `[Category Polling] REMOVED STREAM DETECTED: User ID ${user.user_id} removed after ${MAX_STRIKES} missed polls in category ${filter.category_id}.`,
              );
            } else {
              missingStrikes.set(strikeKey, currentStrikes);
              logger.info(
                `[Category Polling] Streamer ${user.user_id} missing from category ${filter.category_id}. Strike ${currentStrikes}/${MAX_STRIKES}.`,
              );
            }
          }
        }
      }
    } catch (error) {
      logger.error("Error during category polling:", error);
    } finally {
      isPolling = false;
    }
  }, 60000);
}
