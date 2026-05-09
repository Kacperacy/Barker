import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} from "discord.js";
import type { Command } from "../types";
import { getGuildSubscriptions } from "../database/repositories/subscriptions";
import { getGuildCategorySubscriptions } from "../database/repositories/categorySubscriptions";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("list")
    .setDescription(
      "View all monitored Twitch streamers and categories on this server",
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

    if (streamerSubs.length === 0 && categorySubs.length === 0) {
      await interaction.reply(
        "This server is not monitoring any Twitch activity yet.",
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x9146ff)
      .setTitle("Monitored Twitch Activity")
      .setTimestamp();

    if (streamerSubs.length > 0) {
      const streamerText = streamerSubs
        .map((sub) => `**${sub.streamer_name}** -> <#${sub.channel_id}>`)
        .join("\n");
      embed.addFields({ name: "👥 Streamers", value: streamerText });
    }

    if (categorySubs.length > 0) {
      const categoryText = categorySubs
        .map(
          (sub) =>
            `**${sub.category_name}** (${sub.language.toUpperCase()}) -> <#${sub.channel_id}>`,
        )
        .join("\n");
      embed.addFields({ name: "🎮 Categories", value: categoryText });
    }

    await interaction.reply({ embeds: [embed] });
  },
};
