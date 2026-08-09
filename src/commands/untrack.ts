import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AutocompleteInteraction,
} from "discord.js";
import type { Command } from "../types";
import { requireGuildId } from "../utils/discord";
import { getGuildSubscriptions } from "../database/repositories/subscriptions";
import {
  getGuildCategorySubscriptions,
  removeCategorySubscription,
} from "../database/repositories/categorySubscriptions";
import { getGuildLoLSubscriptions } from "../database/repositories/lolSubscriptions";
import { removeStreamerSubscription } from "../services/twitchSubscriptions";
import { removeLoLSubscription } from "../services/lolSubscriptions";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("untrack")
    .setDescription("Stop monitoring a streamer, category, or LoL player")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("streamer")
        .setDescription("Stop tracking a specific Twitch streamer")
        .addStringOption((opt) =>
          opt
            .setName("username")
            .setDescription("Select the streamer")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("category")
        .setDescription("Stop tracking a specific Twitch category")
        .addStringOption((opt) =>
          opt
            .setName("category")
            .setDescription("Select the category")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("lol")
        .setDescription("Stop tracking a League of Legends player")
        .addStringOption((opt) =>
          opt
            .setName("riotid")
            .setDescription("Select the Riot ID")
            .setRequired(true)
            .setAutocomplete(true),
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
        filtered.slice(0, 25).map((sub) => ({
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
    } else if (subcommand === "lol") {
      const subs = getGuildLoLSubscriptions(guildId);
      const filtered = subs.filter((sub) =>
        sub.riot_id.toLowerCase().includes(focusedValue),
      );
      await interaction.respond(
        filtered.slice(0, 25).map((sub) => ({
          name: `${sub.riot_id} (${sub.region.toUpperCase()})`,
          value: sub.puuid, // Hidden autocomplete value used to identify the row on removal
        })),
      );
    }
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    const guildId = await requireGuildId(interaction);
    if (!guildId) return;

    if (subcommand === "streamer") {
      const username = interaction.options
        .getString("username", true)
        .toLowerCase();

      await removeStreamerSubscription(guildId, username);

      await interaction.reply(
        `✅ Stopped monitoring streamer **${username}** on this server.`,
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

      removeCategorySubscription(guildId, categoryName, language);
      await interaction.reply(
        `✅ Stopped monitoring category **${categoryName}** (${language}) on this server.`,
      );
    }

    if (subcommand === "lol") {
      const puuid = interaction.options.getString("riotid", true);

      const result = removeLoLSubscription(guildId, puuid);
      if (!result.ok) {
        await interaction.reply({
          content: `❌ ${result.error}`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply(
        `✅ Stopped monitoring League of Legends matches for **${result.riotId}** on this server.`,
      );
    }
  },
};
