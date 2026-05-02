import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AutocompleteInteraction,
} from "discord.js";
import type { Command } from "../types";
import {
  getGuildCategorySubscriptions,
  updateCategorySubscriptionMessage,
} from "../database/repositories/categorySubscriptions";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("edit-category")
    .setDescription(
      "Edits the custom message for an existing category subscription",
    )
    .addStringOption((opt) =>
      opt
        .setName("category")
        .setDescription("Select the category")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("message")
        .setDescription("New custom message. Use {streamer} & {game}.")
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async autocomplete(interaction: AutocompleteInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) return interaction.respond([]);

    const focusedValue = interaction.options.getFocused().toLowerCase();
    const subs = getGuildCategorySubscriptions(guildId);

    const filtered = subs.filter((sub) =>
      sub.category_name.toLowerCase().includes(focusedValue),
    );

    await interaction.respond(
      filtered.slice(0, 25).map((sub) => ({
        name: `${sub.category_name} (${sub.language})`,
        value: `${sub.category_name}|${sub.language}`,
      })),
    );
  },

  async execute(interaction) {
    const selection = interaction.options.getString("category")!;
    const newMessage = interaction.options.getString("message")!;
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    const [categoryName, language] = selection.split("|");

    if (!categoryName || !language) {
      await interaction.reply({
        content: "Invalid selection. Please use the autocomplete options.",
        ephemeral: true,
      });
      return;
    }

    updateCategorySubscriptionMessage(
      guildId,
      categoryName,
      language,
      newMessage,
    );

    await interaction.reply(
      `Updated custom message for **${categoryName}** (${language}).`,
    );
  },
};
