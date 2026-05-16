import { Client, TextChannel } from "discord.js";
import {
  getLatestMatchId,
  getMatchDetails,
  REGIONS,
  getSummonerData,
  getLeagueData,
} from "./api";
import { logger } from "../utils/logger";
import {
  getAllUniqueLoLPlayers,
  getLastMatch,
  updateLastMatch,
  getSubscriptionsForLoLPlayer,
} from "../database/repositories/lolSubscriptions";
import { buildLoLLiveEmbed } from "../discord/notifier";

let shouldSkipPolling = false;

function capitalizeFirst(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function startRiotPolling(client: Client) {
  setInterval(async () => {
    if (shouldSkipPolling) return;
    shouldSkipPolling = true;

    try {
      const uniquePlayers = getAllUniqueLoLPlayers();

      for (const player of uniquePlayers) {
        const regionData = REGIONS[player.region];
        if (!regionData) continue;

        const latestMatchId = await getLatestMatchId(
          player.puuid,
          regionData.regional,
        );
        if (!latestMatchId) continue;

        const lastKnownMatch = getLastMatch(player.puuid);
        const shouldNotifyNewMatch =
          !lastKnownMatch || lastKnownMatch.match_id !== latestMatchId;

        if (shouldNotifyNewMatch) {
          const matchData = await getMatchDetails(
            latestMatchId,
            regionData.regional,
          );
          if (!matchData) continue;

          // Pobieranie LP i rangi
          const summoner = await getSummonerData(
            player.puuid,
            regionData.platform,
          );
          let soloQ: any = null;

          if (summoner) {
            const leagueEntries = await getLeagueData(
              summoner.id,
              regionData.platform,
            );
            if (leagueEntries) {
              soloQ = leagueEntries.find(
                (e) => e.queueType === "RANKED_SOLO_5x5",
              );
            }
          }

          let rankText = "";
          let lpChangeText = "";

          if (soloQ) {
            rankText = `${capitalizeFirst(soloQ.tier)} ${soloQ.rank} - ${soloQ.leaguePoints} LP`;

            if (
              lastKnownMatch &&
              lastKnownMatch.tier &&
              matchData.info.queueId === 420
            ) {
              // 420 = Solo/Duo Queue
              if (
                lastKnownMatch.tier === soloQ.tier &&
                lastKnownMatch.rank === soloQ.rank
              ) {
                const lpDiff =
                  soloQ.leaguePoints - (lastKnownMatch.league_points || 0);
                if (lpDiff > 0) lpChangeText = ` (+${lpDiff})`;
                else if (lpDiff < 0) lpChangeText = ` (${lpDiff})`;
              } else {
                lpChangeText = " (Rank Changed!)";
              }
            }
          }

          const subs = getSubscriptionsForLoLPlayer(player.puuid);
          const embed = buildLoLLiveEmbed(
            matchData,
            player.puuid,
            player.riot_id,
            regionData.opgg,
            rankText,
            lpChangeText,
          );

          for (const sub of subs) {
            const channel = (await client.channels.fetch(
              sub.channel_id,
            )) as TextChannel;
            if (channel) {
              await channel.send({ embeds: [embed] });
            }
          }

          updateLastMatch(
            player.puuid,
            latestMatchId,
            soloQ ? soloQ.tier : null,
            soloQ ? soloQ.rank : null,
            soloQ ? soloQ.leaguePoints : null,
          );
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
