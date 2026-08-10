import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import type { Command } from "../types";
import { addPlatformOption, getPlatformOption, requireGuildId } from "../utils/discord";
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
        .setDescription("Username to blacklist")
        .setRequired(true),
    )
    .addStringOption(addPlatformOption)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const username = interaction.options.getString("username")!.toLowerCase();
    const platform = getPlatformOption(interaction);

    const guildId = await requireGuildId(interaction);
    if (!guildId) return;

    addBlacklist(guildId, username, platform);

    await interaction.reply(
      `✅ **${username}** has been blacklisted and will no longer trigger category notifications.`,
    );
  },
};
