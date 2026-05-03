import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";
import type { Command } from "../types";
import { addSubscription } from "../database/repositories/subscriptions";
import { addCategorySubscription } from "../database/repositories/categorySubscriptions";
import { getTwitchCategoryId } from "../twitch/api";
import { subscribeToStreamer } from "../twitch/eventsub";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("notify")
    .setDescription("Manage Twitch notifications for this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("streamer")
        .setDescription("Set up notifications for a specific streamer")
        .addStringOption((opt) =>
          opt
            .setName("username")
            .setDescription("Twitch username")
            .setRequired(true),
        )
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Target channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("message")
            .setDescription("Custom message. Use {streamer} & {game}")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("category")
        .setDescription("Set up notifications for an entire category")
        .addStringOption((opt) =>
          opt
            .setName("category")
            .setDescription("Exact category name")
            .setRequired(true),
        )
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Target channel")
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
            .setDescription("Custom message. Use {streamer} & {game}")
            .setRequired(false),
        ),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const channel = interaction.options.getChannel("channel", true);
    const message = interaction.options.getString("message");

    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    if (subcommand === "streamer") {
      const username = interaction.options
        .getString("username", true)
        .toLowerCase();

      addSubscription(guildId, channel.id, username, message);
      await subscribeToStreamer(username);

      await interaction.reply(
        `✅ Now tracking streamer **${username}** in <#${channel.id}>.`,
      );
    }

    if (subcommand === "category") {
      await interaction.deferReply();

      const categoryName = interaction.options.getString("category", true);
      const language = interaction.options
        .getString("language", true)
        .toLowerCase();
      const categoryId = await getTwitchCategoryId(categoryName);

      if (!categoryId) {
        await interaction.editReply(
          `❌ Could not find category **${categoryName}**.`,
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
        `✅ Now tracking category **${categoryName}** (${language}) in <#${channel.id}>.`,
      );
    }
  },
};
