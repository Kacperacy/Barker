import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";
import type { Command } from "../types";
import { addCategorySubscription } from "../database/repositories/categorySubscriptions";
import { getTwitchCategoryId } from "../twitch/api";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("add-category")
    .setDescription(
      "Monitors an entire Twitch category for a specific language",
    )
    .addStringOption((opt) =>
      opt
        .setName("category")
        .setDescription(
          "Exact Twitch Category Name (e.g., Software and Game Development)",
        )
        .setRequired(true),
    )
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Channel to send notifications")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("language")
        .setDescription("2-letter language code (e.g., pl, en)")
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("message")
        .setDescription("Custom text. Use {streamer} & {game}.")
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const categoryName = interaction.options.getString("category")!;
    const channel = interaction.options.getChannel("channel")!;
    const language = interaction.options.getString("language")!.toLowerCase();
    const message = interaction.options.getString("message");
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const categoryId = await getTwitchCategoryId(categoryName);

    if (!categoryId) {
      await interaction.editReply(
        `❌ Could not find a category named **${categoryName}**. Make sure the spelling is exact.`,
      );
      return;
    }

    addCategorySubscription(
      guildId,
      channel.id,
      categoryId,
      categoryName,
      language,
      message,
    );

    await interaction.editReply(
      `✅ Now monitoring category **${categoryName}** (${language}) in <#${channel.id}>.`,
    );
  },
};
