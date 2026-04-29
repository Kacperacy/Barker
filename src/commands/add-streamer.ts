import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";
import type { Command } from "../types";
import { addSubscription } from "../database/repositories/subscriptions";
import { subscribeToStreamer } from "../twitch/eventsub";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("add-streamer")
    .setDescription("Adds a Twitch streamer to monitor")
    .addStringOption((opt) =>
      opt
        .setName("username")
        .setDescription("Streamer's Twitch username")
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
        .setName("message")
        .setDescription(
          "Custom text. Use {streamer} & {game}. Leave blank for @everyone default.",
        )
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const username = interaction.options.getString("username")!.toLowerCase();
    const channel = interaction.options.getChannel("channel")!;
    const message = interaction.options.getString("message");
    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    addSubscription(guildId, channel.id, username, message);

    subscribeToStreamer(username);

    await interaction.reply(
      `✅ Now monitoring **${username}** in <#${channel.id}>.\nMessage: \`${message || "Default with @everyone"}\``,
    );
  },
};
