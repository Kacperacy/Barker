import { Client, TextChannel, EmbedBuilder } from "discord.js";
import { logger } from "../utils/logger";

export function buildLiveEmbed(stream: any): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x9146ff)
    .setTitle(stream.title)
    .setURL(`https://twitch.tv/${stream.user_login}`)
    .setAuthor({
      name: `${stream.user_name} is live in ${stream.game_name || "a category"}!`,
      iconURL: "https://cdn-icons-png.flaticon.com/512/5968/5968819.png",
    })
    .addFields(
      {
        name: "Language",
        value: stream.language ? stream.language.toUpperCase() : "N/A",
        inline: true,
      },
      { name: "Viewers", value: stream.viewer_count.toString(), inline: true },
    )
    .setImage(
      stream.thumbnail_url
        .replace("{width}", "1280")
        .replace("{height}", "720"),
    )
    .setTimestamp();
}

export function buildOfflineEmbed(
  broadcasterName: string,
  login: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x808080)
    .setAuthor({
      name: `${broadcasterName} was live`,
      iconURL: "https://cdn-icons-png.flaticon.com/512/5968/5968819.png",
    })
    .setTitle("Stream has ended")
    .setURL(`https://twitch.tv/${login}`)
    .setDescription("Catch them next time!")
    .setTimestamp();
}

export function formatNotificationText(
  template: string,
  streamerName: string,
  gameName: string,
): string {
  return template
    .replace(/{streamer}/gi, streamerName)
    .replace(/{game}/gi, gameName || "a category");
}

export async function sendStreamNotification(
  client: Client,
  channelId: string,
  stream: any,
  customMessage: string | null | undefined,
  defaultTemplate: string,
): Promise<string | null> {
  try {
    const channel = (await client.channels.fetch(channelId)) as TextChannel;
    if (!channel) return null;

    const templateToUse = customMessage || defaultTemplate;
    const textContent = formatNotificationText(
      templateToUse,
      stream.user_name,
      stream.game_name,
    );
    const embed = buildLiveEmbed(stream);

    const sentMessage = await channel.send({
      content: textContent,
      embeds: [embed],
    });
    return sentMessage.id;
  } catch (err) {
    logger.error(`Could not send message to channel ${channelId}:`, err);
    return null;
  }
}

export async function editMessageToOffline(
  client: Client,
  channelId: string,
  messageId: string,
  broadcasterName: string,
  login: string,
): Promise<void> {
  try {
    const channel = (await client.channels.fetch(channelId)) as TextChannel;
    if (!channel) return;

    const messageToEdit = await channel.messages.fetch(messageId);
    if (!messageToEdit) return;

    const embedOffline = buildOfflineEmbed(broadcasterName, login);

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
}
