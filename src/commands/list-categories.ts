import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} from "discord.js";
import type { Command } from "../types";
import { getGuildCategorySubscriptions } from "../database/repositories/categorySubscriptions";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("list-categories")
    .setDescription("Lists all monitored Twitch categories on this server")
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

    const subs = getGuildCategorySubscriptions(guildId);

    if (subs.length === 0) {
      await interaction.reply(
        "This server is not monitoring any Twitch categories yet.",
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x9146ff)
      .setTitle("Monitored Twitch Categories")
      .setDescription(
        subs
          .map(
            (sub) =>
              `**${sub.category_name}** (${sub.language.toUpperCase()}) -> <#${sub.channel_id}>\n*Message:* ${
                sub.custom_message || "Default"
              }`,
          )
          .join("\n\n"),
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
