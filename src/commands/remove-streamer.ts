import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AutocompleteInteraction,
} from "discord.js";
import type { Command } from "../types";
import {
  removeSubscription,
  getGuildSubscriptions,
} from "../services/database";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("remove-streamer")
    .setDescription("Stops monitoring a Twitch streamer on this server")
    .addStringOption((opt) =>
      opt
        .setName("username")
        .setDescription("Select the streamer's Twitch username")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async autocomplete(interaction: AutocompleteInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) return interaction.respond([]);

    const focusedValue = interaction.options.getFocused().toLowerCase();
    const subs = getGuildSubscriptions(guildId);

    const filtered = subs.filter((sub) =>
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

    removeSubscription(guildId, username);
    await interaction.reply(
      `Stopped monitoring **${username}** on this server.`,
    );
  },
};
