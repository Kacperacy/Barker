import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} from "discord.js";
import type { Command, Platform } from "../types";
import { requireGuildId } from "../utils/discord";
import {
  getGuildSubscriptions,
  type Subscription,
} from "../database/repositories/subscriptions";
import {
  getGuildCategorySubscriptions,
  type CategorySubscription,
} from "../database/repositories/categorySubscriptions";
import { getGuildLoLSubscriptions } from "../database/repositories/lolSubscriptions";

function truncate(text: string): string {
  return text.length > 1024 ? text.substring(0, 1021) + "..." : text;
}

function formatStreamerSection(subs: Subscription[]): string {
  return truncate(
    subs
      .map(
        (sub) =>
          `**${sub.streamer_name}** -> <#${sub.channel_id}>\n> 📝 Message: ${
            sub.custom_message ? `\`${sub.custom_message}\`` : "*Default*"
          }`,
      )
      .join("\n\n"),
  );
}

function formatCategorySection(subs: CategorySubscription[]): string {
  return truncate(
    subs
      .map(
        (sub) =>
          `**${sub.category_name}** (${sub.language.toUpperCase()}) -> <#${sub.channel_id}>\n> 📝 Message: ${
            sub.custom_message ? `\`${sub.custom_message}\`` : "*Default*"
          }`,
      )
      .join("\n\n"),
  );
}

export const command: Command = {
  data: new SlashCommandBuilder()
    .setName("list")
    .setDescription(
      "View all monitored Twitch/Kick activity and LoL players on this server",
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const guildId = await requireGuildId(interaction);
    if (!guildId) return;

    const streamerSubs = getGuildSubscriptions(guildId);
    const categorySubs = getGuildCategorySubscriptions(guildId);
    const lolSubs = getGuildLoLSubscriptions(guildId);

    if (
      streamerSubs.length === 0 &&
      categorySubs.length === 0 &&
      lolSubs.length === 0
    ) {
      await interaction.reply(
        "This server is not monitoring any activity yet.",
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x9146ff)
      .setTitle("Monitored Activity")
      .setTimestamp();

    const byPlatform = <T extends { platform: Platform }>(
      subs: T[],
      platform: Platform,
    ) => subs.filter((sub) => sub.platform === platform);

    const streamerSections: [string, Subscription[]][] = [
      ["👥 Twitch Streamers", byPlatform(streamerSubs, "twitch")],
      ["👥 Kick Streamers", byPlatform(streamerSubs, "kick")],
    ];
    for (const [name, subs] of streamerSections) {
      if (subs.length > 0) {
        embed.addFields({ name, value: formatStreamerSection(subs) });
      }
    }

    const categorySections: [string, CategorySubscription[]][] = [
      ["🎮 Twitch Categories", byPlatform(categorySubs, "twitch")],
      ["🎮 Kick Categories", byPlatform(categorySubs, "kick")],
    ];
    for (const [name, subs] of categorySections) {
      if (subs.length > 0) {
        embed.addFields({ name, value: formatCategorySection(subs) });
      }
    }

    if (lolSubs.length > 0) {
      const lolText = lolSubs
        .map(
          (sub) =>
            `**${sub.riot_id}** (${sub.region.toUpperCase()}) -> <#${sub.channel_id}>`,
        )
        .join("\n");

      embed.addFields({
        name: "⚔️ League of Legends",
        value: truncate(lolText),
      });
    }

    await interaction.reply({ embeds: [embed] });
  },
};
