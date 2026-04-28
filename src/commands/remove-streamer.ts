import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import type { Command } from "../types";
import { removeSubscription } from "../services/database";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("remove-streamer")
    .setDescription("Stops monitoring a Twitch streamer on this server")
    .addStringOption((opt) =>
      opt
        .setName("username")
        .setDescription("Streamer's Twitch username")
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    const username = interaction.options.getString("username")!.toLowerCase();
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    removeSubscription(guildId, username);
    await interaction.reply(
      `Stopped monitoring **${username}** on this server.`,
    );
  },
};
