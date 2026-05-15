import { Client, TextChannel } from "discord.js";
import { getLatestMatchId, getMatchDetails } from "./api";
import { logger } from "../utils/logger";
import {
  getAllUniqueLoLPlayers,
  getLastMatch,
  updateLastMatch,
  getSubscriptionsForLoLPlayer,
} from "../database/repositories/lolSubscriptions";
import { buildLoLLiveEmbed } from "../discord/notifier";

let shouldSkipPolling = false;

export function startRiotPolling(client: Client) {
  setInterval(async () => {
    if (shouldSkipPolling) return;
    shouldSkipPolling = true;

    try {
      const uniquePlayers = getAllUniqueLoLPlayers();

      for (const player of uniquePlayers) {
        const latestMatchId = await getLatestMatchId(player.puuid);
        if (!latestMatchId) continue;

        const lastKnownMatch = getLastMatch(player.puuid);
        const shouldNotifyNewMatch =
          !lastKnownMatch || lastKnownMatch !== latestMatchId;

        if (shouldNotifyNewMatch) {
          const matchData = await getMatchDetails(latestMatchId);
          if (!matchData) continue;

          const subs = getSubscriptionsForLoLPlayer(player.puuid);
          const embed = buildLoLLiveEmbed(
            matchData,
            player.puuid,
            player.riot_id,
          );

          for (const sub of subs) {
            const channel = (await client.channels.fetch(
              sub.channel_id,
            )) as TextChannel;
            if (channel) {
              await channel.send({ embeds: [embed] });
            }
          }

          updateLastMatch(player.puuid, latestMatchId);
          logger.info(
            `Processed new match ${latestMatchId} for ${player.riot_id}`,
          );
        }
      }
    } catch (error) {
      logger.error("Riot polling error:", error);
    } finally {
      shouldSkipPolling = false;
    }
  }, 120000);
}
