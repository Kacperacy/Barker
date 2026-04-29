import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AutocompleteInteraction,
} from "discord.js";
import type { Command } from "../types";
import {
  getGuildSubscriptions,
  updateSubscriptionMessage,
} from "../database/repositories/subscriptions";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("edit-message")
    .setDescription(
      "Edits the notification message for an already monitored streamer",
    )
    .addStringOption((opt) =>
      opt
        .setName("username")
        .setDescription("Select the streamer's Twitch username")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("message")
        .setDescription(
          "Custom text. Use {streamer} and {game}. Use 'default' to revert.",
        )
        .setRequired(true),
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
    let message: string | null = interaction.options.getString("message")!;
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    if (message.toLowerCase() === "default") {
      message = null;
    }

    updateSubscriptionMessage(guildId, username, message);

    await interaction.reply({
      content: `✅ Updated message for **${username}**:\n\`${message || "Default with @everyone"}\``,
      ephemeral: true,
    });
  },
};
