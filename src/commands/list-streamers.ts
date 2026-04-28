import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} from "discord.js";
import type { Command } from "../types";
import { getGuildSubscriptions } from "../services/database";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("list-streamers")
    .setDescription("Lists all monitored Twitch streamers on this server")
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

    const subs = getGuildSubscriptions(guildId);

    if (subs.length === 0) {
      await interaction.reply({
        content: "ℹ️ You are not monitoring any streamers on this server.",
        ephemeral: true,
      });
      return;
    }

    const description = subs
      .map((sub) => `• **${sub.streamer_name}** ➔ <#${sub.channel_id}>`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x9146ff)
      .setTitle("📡 Monitored Streamers")
      .setDescription(description)
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
