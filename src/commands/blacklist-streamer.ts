import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import type { Command } from "../types";
import { addBlacklist } from "../database/repositories/blacklist";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("blacklist-streamer")
    .setDescription(
      "Prevents a specific streamer from triggering category notifications on this server",
    )
    .addStringOption((opt) =>
      opt
        .setName("username")
        .setDescription("Twitch username to blacklist")
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

    addBlacklist(guildId, username);

    await interaction.reply(
      `✅ **${username}** has been blacklisted and will no longer trigger category notifications.`,
    );
  },
};
