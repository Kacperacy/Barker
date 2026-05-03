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
    .setDescription("View all monitored streamers or categories on this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("streamers")
        .setDescription("List all monitored Twitch streamers"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("categories")
        .setDescription("List all monitored Twitch categories"),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    if (subcommand === "streamers") {
      const subs = getGuildSubscriptions(guildId);
      if (subs.length === 0) {
        await interaction.reply(
          "This server is not monitoring any Twitch streamers yet.",
        );
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x9146ff)
        .setTitle("Monitored Twitch Streamers")
        .setDescription(
          subs
            .map(
              (sub) =>
                `**${sub.streamer_name}** -> <#${sub.channel_id}>\n*Message:* ${sub.custom_message || "Default"}`,
            )
            .join("\n\n"),
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    if (subcommand === "categories") {
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
                `**${sub.category_name}** (${sub.language.toUpperCase()}) -> <#${sub.channel_id}>\n*Message:* ${sub.custom_message || "Default"}`,
            )
            .join("\n\n"),
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  },
};
