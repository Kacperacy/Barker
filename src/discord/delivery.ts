import { Client, TextChannel, EmbedBuilder } from "discord.js";
import type { Platform } from "../types";
import { logger } from "../utils/logger";
import { queueDiscordAction } from "../utils/queue";
import {
  buildKickLiveEmbed,
  buildKickOfflineEmbed,
  buildLiveEmbed,
  buildOfflineEmbed,
  formatNotificationText,
} from "./embeds";

export async function sendStreamNotification(
  client: Client,
  channelId: string,
  platform: Platform,
  stream: any,
  streamerName: string,
  categoryName: string | undefined,
  customMessage: string | null | undefined,
  defaultTemplate: string,
): Promise<string | null> {
  return queueDiscordAction(channelId, async () => {
    try {
      const channel = (await client.channels.fetch(channelId)) as TextChannel;
      if (!channel) return null;

      const templateToUse = customMessage || defaultTemplate;
      const textContent = formatNotificationText(
        templateToUse,
        streamerName,
        categoryName ?? "",
      );
      const embed =
        platform === "kick" ? buildKickLiveEmbed(stream) : buildLiveEmbed(stream);

      const sentMessage = await channel.send({
        content: textContent,
        embeds: [embed],
      });
      return sentMessage.id;
    } catch (err) {
      logger.error(`Could not send message to channel ${channelId}:`, err);
      return null;
    }
  });
}

export async function editMessageToOffline(
  client: Client,
  channelId: string,
  messageId: string,
  platform: Platform,
  broadcasterName: string,
  login: string,
): Promise<void> {
  await queueDiscordAction(channelId, async () => {
    try {
      const channel = (await client.channels.fetch(channelId)) as TextChannel;
      if (!channel) return;

      const messageToEdit = await channel.messages.fetch(messageId);
      if (!messageToEdit) return;

      const embedOffline =
        platform === "kick"
          ? buildKickOfflineEmbed(broadcasterName, login)
          : buildOfflineEmbed(broadcasterName, login);

      await messageToEdit.edit({
        content: `~~${broadcasterName}~~ (Offline)`,
        embeds: [embedOffline],
      });
    } catch (err) {
      logger.error(
        `Could not edit offline message in channel ${channelId}:`,
        err,
      );
    }
  });
}

export async function sendLoLMatchNotification(
  client: Client,
  channelId: string,
  embed: EmbedBuilder,
): Promise<string | null> {
  return queueDiscordAction(channelId, async () => {
    try {
      const channel = (await client.channels.fetch(channelId)) as TextChannel;
      if (!channel) return null;

      const sentMessage = await channel.send({ embeds: [embed] });
      return sentMessage.id;
    } catch (err) {
      logger.error(
        `Could not send LoL match notification to channel ${channelId}:`,
        err,
      );
      return null;
    }
  });
}
