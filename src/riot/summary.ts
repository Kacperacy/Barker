import { Client, TextChannel, EmbedBuilder } from "discord.js";
import { logger } from "../utils/logger";
import {
  getAllLoLChannels,
  getLoLSubscriptionsByChannel,
  getPlayerMatchesSince,
  getPlayerStreak,
} from "../database/repositories/lolSubscriptions";

export async function sendDailyLoLSummary(client: Client) {
  logger.info(
    "[Riot Summary] Starting generation of daily summaries from database...",
  );
  const channels = getAllLoLChannels();

  const startTimeMs = Date.now() - 24 * 60 * 60 * 1000;

  for (const { channel_id } of channels) {
    const subs = getLoLSubscriptionsByChannel(channel_id);
    if (subs.length === 0) continue;

    const embed = new EmbedBuilder()
      .setTitle("📅 Daily League of Legends Summary (Last 24h)")
      .setColor(0x0099ff)
      .setTimestamp();

    let hasAnyMatches = false;

    for (const sub of subs) {
      const matches = getPlayerMatchesSince(sub.puuid, startTimeMs);
      if (matches.length === 0) continue;

      hasAnyMatches = true;
      let wins = 0;
      let losses = 0;
      let remakes = 0;
      let totalKills = 0;
      let totalDeaths = 0;
      let totalAssists = 0;

      for (const match of matches) {
        if (match.is_remake === 1) {
          remakes++;
        } else if (match.win === 1) {
          wins++;
        } else {
          losses++;
        }

        totalKills += match.kills;
        totalDeaths += match.deaths;
        totalAssists += match.assists;
      }

      const totalPlayed = wins + losses;
      const winrate =
        totalPlayed > 0 ? Math.round((wins / totalPlayed) * 100) : 0;
      const kda =
        totalDeaths > 0
          ? ((totalKills + totalAssists) / totalDeaths).toFixed(2)
          : "Perfect";

      const streak = getPlayerStreak(sub.puuid);

      let summaryText = `**Record:** ${wins}W - ${losses}L`;
      if (remakes > 0)
        summaryText += ` (${remakes} Remake${remakes > 1 ? "s" : ""})`;
      summaryText += `\n**Winrate:** ${winrate}%\n**Average KDA:** ${kda}\n**Current Streak:** ${streak}`;

      embed.addFields({ name: sub.riot_id, value: summaryText, inline: true });
    }

    if (hasAnyMatches) {
      try {
        const channel = (await client.channels.fetch(
          channel_id,
        )) as TextChannel;
        if (channel) {
          await channel.send({ embeds: [embed] });
          logger.info(`[Riot Summary] Sent summary to channel ${channel_id}`);
        }
      } catch (error) {
        logger.error(
          `[Riot Summary] Failed to send summary to channel ${channel_id}:`,
          error,
        );
      }
    }
  }
}

export function startDailySummaryTimer(client: Client) {
  setInterval(() => {
    const now = new Date();
    if (now.getHours() === 6 && now.getMinutes() === 0) {
      sendDailyLoLSummary(client);
    }
  }, 60000);
}
