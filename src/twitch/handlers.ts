import { Client, TextChannel, EmbedBuilder } from "discord.js";
import { logger } from "../utils/logger";
import { twitchEvents } from "./eventsub";
import { getStreamData } from "./api";
import { getSubscriptionsForStreamer } from "../database/repositories/subscriptions";
import {
  saveActiveMessage,
  getActiveMessages,
  clearActiveMessages,
} from "../database/repositories/activeMessages";

export function setupTwitchHandlers(client: Client) {
  twitchEvents.on("streamOnline", async (eventData) => {
    const login = eventData.broadcaster_user_login.toLowerCase();
    logger.info(`EVENT TRIGGERED: ${login} went live!`);

    setTimeout(async () => {
      const stream = await getStreamData(login);
      if (!stream) return;

      const subs = getSubscriptionsForStreamer(login);
      if (subs.length === 0) return;

      const embed = new EmbedBuilder()
        .setColor(0x9146ff)
        .setTitle(stream.title)
        .setURL(`https://twitch.tv/${login}`)
        .setAuthor({
          name: `${stream.user_name} is now live!`,
          iconURL: "https://cdn-icons-png.flaticon.com/512/5968/5968819.png",
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
  });

  twitchEvents.on("streamOffline", async (eventData) => {
    const login = eventData.broadcaster_user_login.toLowerCase();
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
  });
}
