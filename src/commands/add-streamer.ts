import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";
import type { Command } from "../types";
import { addSubscription } from "../services/database";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("add-streamer")
    .setDescription("Adds a Twitch streamer to monitor on a specific channel")
    .addStringOption((opt) =>
      opt
        .setName("username")
        .setDescription("Streamer's Twitch username")
        .setRequired(true),
    )
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Channel to send notifications")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const username = interaction.options.getString("username")!.toLowerCase();
    const channel = interaction.options.getChannel("channel")!;
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    addSubscription(guildId, channel.id, username);
    await interaction.reply(
      `Now monitoring **${username}**. Notifications will be sent to <#${channel.id}>.`,
    );
  },
};
