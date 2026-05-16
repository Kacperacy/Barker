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

      if (uniquePlayers.length > 0) {
        logger.info(
          `[Riot Polling] Started checking for new matches for ${uniquePlayers.length} players...`,
        );
      }

      for (const player of uniquePlayers) {
        const regionData = REGIONS[player.region];
        if (!regionData) {
          logger.error(
            `[Riot Polling] Invalid region ${player.region} for player ${player.riot_id}`,
          );
          continue;
        }

        const latestMatchId = await getLatestMatchId(
          player.puuid,
          regionData.regional,
        );
        if (!latestMatchId) continue;

        const lastKnownMatch = getLastMatch(player.puuid);
        const shouldNotifyNewMatch =
          !lastKnownMatch || lastKnownMatch.match_id !== latestMatchId;

        if (shouldNotifyNewMatch) {
          logger.info(
            `[Riot Polling] New match detected for ${player.riot_id} (${latestMatchId}). Fetching details...`,
          );

          const matchData = await getMatchDetails(
            latestMatchId,
            regionData.regional,
          );
          if (!matchData) {
            logger.error(
              `[Riot Polling] Failed to fetch match details for ${latestMatchId}`,
            );
            continue;
          }

          // Fetching LP and Rank
          const summoner = await getSummonerData(
            player.puuid,
            regionData.platform,
          );
          let soloQ: any = null;

          if (!summoner || !summoner.id) {
            logger.warn(
              `[Riot Polling] Could not find Summoner ID for ${player.riot_id}. Cannot fetch rank.`,
            );
          } else {
            const leagueEntries = await getLeagueData(
              summoner.id,
              regionData.platform,
            );

            logger.info(
              `[Riot Polling] League Entries raw data for ${player.riot_id}: ${JSON.stringify(leagueEntries)}`,
            );

            if (leagueEntries && Array.isArray(leagueEntries)) {
              soloQ = leagueEntries.find(
                (e: any) => e.queueType === "RANKED_SOLO_5x5",
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
          } else {
            logger.warn(
              `[Riot Polling] soloQ is null for ${player.riot_id}, falling back to Unranked.`,
            );
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
              logger.info(
                `[Riot Polling] Notification sent for ${player.riot_id} to channel ${sub.channel_id}`,
              );
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
            `[Riot Polling] Successfully processed and saved match ${latestMatchId} for ${player.riot_id}`,
          );
        }
      }
    } catch (error) {
      logger.error("[Riot Polling] Critical Error:", error);
    } finally {
      shouldSkipPolling = false;
    }
  }, 120000);
}
