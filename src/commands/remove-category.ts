import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AutocompleteInteraction,
} from "discord.js";
import type { Command } from "../types";
import {
  getGuildCategorySubscriptions,
  removeCategorySubscription,
} from "../database/repositories/categorySubscriptions";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("remove-category")
    .setDescription("Stops monitoring a Twitch category on this server")
    .addStringOption((opt) =>
      opt
        .setName("category")
        .setDescription("Select the category to remove")
        .setRequired(true)
        .setAutocomplete(true),
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

    removeCategorySubscription(guildId, categoryName, language);

    await interaction.reply(
      `Stopped monitoring **${categoryName}** (${language}) on this server.`,
    );
  },
};
