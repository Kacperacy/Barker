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
import {
  getGuildCategorySubscriptions,
  updateCategorySubscriptionMessage,
} from "../database/repositories/categorySubscriptions";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("edit")
    .setDescription(
      "Edit the custom notification message for a streamer or category",
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("streamer")
        .setDescription("Edit the message for a specific Twitch streamer")
        .addStringOption((opt) =>
          opt
            .setName("username")
            .setDescription("Select the streamer")
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("message")
            .setDescription("New custom message. Use {streamer} & {game}")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("category")
        .setDescription("Edit the message for a specific Twitch category")
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
            .setDescription("New custom message. Use {streamer} & {game}")
            .setRequired(true),
        ),
    ),

  async autocomplete(interaction: AutocompleteInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) return interaction.respond([]);

    const focusedValue = interaction.options.getFocused().toLowerCase();
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "streamer") {
      const subs = getGuildSubscriptions(guildId);
      const filtered = subs.filter((sub) =>
        sub.streamer_name.startsWith(focusedValue),
      );
      await interaction.respond(
        filtered
          .slice(0, 25)
          .map((sub) => ({
            name: sub.streamer_name,
            value: sub.streamer_name,
          })),
      );
    } else if (subcommand === "category") {
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
    }
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    const newMessage = interaction.options.getString("message", true);

    if (subcommand === "streamer") {
      const username = interaction.options
        .getString("username", true)
        .toLowerCase();

      updateSubscriptionMessage(guildId, username, newMessage);
      await interaction.reply(
        `✅ Updated custom message for streamer **${username}**.`,
      );
    }

    if (subcommand === "category") {
      const selection = interaction.options.getString("category", true);
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
        `✅ Updated custom message for category **${categoryName}** (${language}).`,
      );
    }
  },
};
