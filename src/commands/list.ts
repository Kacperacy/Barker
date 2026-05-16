import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} from "discord.js";
import type { Command } from "../types";
import { getGuildSubscriptions } from "../database/repositories/subscriptions";
import { getGuildCategorySubscriptions } from "../database/repositories/categorySubscriptions";
import { getGuildLoLSubscriptions } from "../database/repositories/lolSubscriptions";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("list")
    .setDescription(
      "View all monitored Twitch activity and LoL players on this server",
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    const streamerSubs = getGuildSubscriptions(guildId);
    const categorySubs = getGuildCategorySubscriptions(guildId);
    const lolSubs = getGuildLoLSubscriptions(guildId);

    if (
      streamerSubs.length === 0 &&
      categorySubs.length === 0 &&
      lolSubs.length === 0
    ) {
      await interaction.reply(
        "This server is not monitoring any activity yet.",
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x9146ff)
      .setTitle("Monitored Activity")
      .setTimestamp();

    if (streamerSubs.length > 0) {
      const streamerText = streamerSubs
        .map(
          (sub) =>
            `**${sub.streamer_name}** -> <#${sub.channel_id}>\n> 📝 Wiadomość: ${
              sub.custom_message ? `\`${sub.custom_message}\`` : "*Domyślna*"
            }`,
        )
        .join("\n\n");

      embed.addFields({
        name: "👥 Twitch Streamers",
        value:
          streamerText.length > 1024
            ? streamerText.substring(0, 1021) + "..."
            : streamerText,
      });
    }

    if (categorySubs.length > 0) {
      const categoryText = categorySubs
        .map(
          (sub) =>
            `**${sub.category_name}** (${sub.language.toUpperCase()}) -> <#${sub.channel_id}>\n> 📝 Wiadomość: ${
              sub.custom_message ? `\`${sub.custom_message}\`` : "*Domyślna*"
            }`,
        )
        .join("\n\n");

      embed.addFields({
        name: "🎮 Twitch Categories",
        value:
          categoryText.length > 1024
            ? categoryText.substring(0, 1021) + "..."
            : categoryText,
      });
    }

    if (lolSubs.length > 0) {
      const lolText = lolSubs
        .map(
          (sub) =>
            `**${sub.riot_id}** (${sub.region.toUpperCase()}) -> <#${sub.channel_id}>`,
        )
        .join("\n");

      embed.addFields({
        name: "⚔️ League of Legends",
        value:
          lolText.length > 1024 ? lolText.substring(0, 1021) + "..." : lolText,
      });
    }

    await interaction.reply({ embeds: [embed] });
  },
};
