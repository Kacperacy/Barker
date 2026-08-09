import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} from "discord.js";
import type { Command } from "../types";
import { requireGuildId } from "../utils/discord";
import {
  addCategorySubscription,
  addStreamerSubscription,
} from "../services/twitchSubscriptions";
import { addLoLSubscription } from "../services/lolSubscriptions";

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("notify")
    .setDescription("Manage notifications for this server")
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
    )
    .addSubcommand((sub) =>
      sub
        .setName("lol")
        .setDescription("Track League of Legends player matches")
        .addStringOption((opt) =>
          opt
            .setName("riotid")
            .setDescription("Riot ID format (Name#Tag)")
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("region")
            .setDescription("Server region")
            .setRequired(true)
            .addChoices(
              { name: "EUNE (Europe Nordic & East)", value: "eune" },
              { name: "EUW (Europe West)", value: "euw" },
              { name: "NA (North America)", value: "na" },
            ),
        )
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Target channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel("channel", true);

    const guildId = await requireGuildId(interaction);
    if (!guildId) return;

    if (subcommand === "streamer") {
      const username = interaction.options
        .getString("username", true)
        .toLowerCase();
      const message = interaction.options.getString("message");

      await addStreamerSubscription(guildId, channel.id, username, message);

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
      const message = interaction.options.getString("message");

      const result = await addCategorySubscription(
        guildId,
        channel.id,
        categoryName,
        language,
        message,
      );

      if (!result.ok) {
        await interaction.editReply(`❌ ${result.error}`);
        return;
      }

      await interaction.editReply(
        `✅ Now tracking category **${categoryName}** (${language}) in <#${channel.id}>.`,
      );
    }

    if (subcommand === "lol") {
      await interaction.deferReply();
      const riotIdInput = interaction.options.getString("riotid", true);
      const region = interaction.options.getString("region", true);

      const result = await addLoLSubscription(
        guildId,
        channel.id,
        riotIdInput,
        region,
      );

      if (!result.ok) {
        await interaction.editReply(`❌ ${result.error}`);
        return;
      }

      await interaction.editReply(
        `✅ Now tracking League of Legends matches for **${result.riotId}** (${result.region.toUpperCase()}) in <#${channel.id}>.`,
      );
    }
  },
};
