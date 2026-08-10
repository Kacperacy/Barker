import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AutocompleteInteraction,
} from "discord.js";
import type { Command } from "../types";
import { addPlatformOption, getPlatformOption, requireGuildId } from "../utils/discord";
import {
  removeBlacklist,
  getGuildBlacklist,
} from "../database/repositories/blacklist";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("unblacklist-streamer")
    .setDescription("Removes a streamer from the category blacklist")
    .addStringOption((opt) =>
      opt
        .setName("username")
        .setDescription("Username to remove from blacklist")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption(addPlatformOption)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async autocomplete(interaction: AutocompleteInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) return interaction.respond([]);

    const focusedValue = interaction.options.getFocused().toLowerCase();
    const platform = getPlatformOption(interaction);
    const blacklisted = getGuildBlacklist(guildId);

    const filtered = blacklisted.filter(
      (sub) =>
        sub.platform === platform &&
        sub.streamer_name.startsWith(focusedValue),
    );

    await interaction.respond(
      filtered
        .slice(0, 25)
        .map((sub) => ({ name: sub.streamer_name, value: sub.streamer_name })),
    );
  },

  async execute(interaction) {
    const username = interaction.options.getString("username")!.toLowerCase();
    const platform = getPlatformOption(interaction);

    const guildId = await requireGuildId(interaction);
    if (!guildId) return;

    removeBlacklist(guildId, username, platform);

    await interaction.reply(
      `✅ **${username}** has been removed from the blacklist.`,
    );
  },
};
