import { Client } from "discord.js";
import { logger } from "../utils/logger";
import { twitchEvents } from "./eventsub";
import { getStreamData } from "./api";
import { getSubscriptionsForStreamer } from "../database/repositories/subscriptions";
import {
  saveActiveMessage,
  getActiveMessages,
  clearActiveMessages,
} from "../database/repositories/activeMessages";
import {
  sendStreamNotification,
  editMessageToOffline,
} from "../discord/notifier";

export function setupTwitchHandlers(client: Client) {
  twitchEvents.on("streamOnline", async (eventData) => {
    const login = eventData.broadcaster_user_login.toLowerCase();
    logger.info(`EVENT TRIGGERED: ${login} went live!`);

    setTimeout(async () => {
      const stream = await getStreamData(login);
      if (!stream) return;

      const subs = getSubscriptionsForStreamer(login);
      if (subs.length === 0) return;

      for (const sub of subs) {
        const messageId = await sendStreamNotification(
          client,
          sub.channel_id,
          stream,
          sub.custom_message,
          `@everyone Hey! **{streamer}** just went live!`,
        );

        if (messageId) {
          saveActiveMessage(login, sub.channel_id, messageId);
        }
      }
    }, 5000);
  });

  twitchEvents.on("streamOffline", async (eventData) => {
    const login = eventData.broadcaster_user_login.toLowerCase();
    logger.info(`EVENT TRIGGERED: ${login} went offline!`);

    const activeMessages = getActiveMessages(login);
    if (activeMessages.length === 0) return;

    for (const msgData of activeMessages) {
      await editMessageToOffline(
        client,
        msgData.channel_id,
        msgData.message_id,
        eventData.broadcaster_user_name,
        login,
      );
    }

    clearActiveMessages(login);
  });
}
