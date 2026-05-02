import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AutocompleteInteraction,
} from "discord.js";
import type { Command } from "../types";
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
        .setDescription("Twitch username to remove from blacklist")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async autocomplete(interaction: AutocompleteInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) return interaction.respond([]);

    const focusedValue = interaction.options.getFocused().toLowerCase();
    const blacklisted = getGuildBlacklist(guildId);

    const filtered = blacklisted.filter((sub) =>
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
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    removeBlacklist(guildId, username);

    await interaction.reply(
      `✅ **${username}** has been removed from the blacklist.`,
    );
  },
};
