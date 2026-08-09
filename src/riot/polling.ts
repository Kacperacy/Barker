import { Client } from "discord.js";
import {
  getLatestMatchId,
  getMatchDetails,
  REGIONS,
  getLeagueData,
} from "./api";
import {
  RANKED_SOLO_QUEUE_ID,
  capitalizeFirst,
  computeLpDiff,
  isRemake,
} from "./rank";
import { logger } from "../utils/logger";
import { env } from "../config";
import {
  getAllUniqueLoLPlayers,
  getLastMatch,
  saveMatchAndUpdateLastMatch,
  getSubscriptionsForLoLPlayer,
  getPlayerStreak,
  type LoLPlayerMatch,
} from "../database/repositories/lolSubscriptions";
import { buildLoLLiveEmbed } from "../discord/embeds";
import { sendLoLMatchNotification } from "../discord/delivery";

let shouldSkipPolling = false;

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
          logger.info(
            `[Riot Polling] New match detected for ${player.riot_id} (${latestMatchId}). Fetching details...`,
          );

          const matchData = await getMatchDetails(
            latestMatchId,
            regionData.regional,
          );
          if (!matchData) continue;

          // Filter to only notify and process Ranked Solo/Duo
          if (matchData.info.queueId !== RANKED_SOLO_QUEUE_ID) {
            logger.info(
              `[Riot Polling] Match ${latestMatchId} is not Solo/Duo Ranked. Skipping notification.`,
            );
            saveMatchAndUpdateLastMatch(null, {
              puuid: player.puuid,
              matchId: latestMatchId,
              tier: lastKnownMatch?.tier || null,
              rank: lastKnownMatch?.rank || null,
              leaguePoints: lastKnownMatch?.league_points ?? null,
            });
            continue;
          }

          const actualPlatform = matchData.info.platformId
            ? matchData.info.platformId.toLowerCase()
            : regionData.platform;

          let soloQ: any = null;

          const leagueEntries = await getLeagueData(
            player.puuid,
            actualPlatform,
          );

          if (leagueEntries && Array.isArray(leagueEntries)) {
            soloQ = leagueEntries.find(
              (e: any) => e.queueType === "RANKED_SOLO_5x5",
            );
          }

          let rankText = "";
          let lpChangeText = "";
          let lpChangeForMatch: number | null = null;

          if (soloQ) {
            rankText = `${capitalizeFirst(soloQ.tier)} ${soloQ.rank} - ${soloQ.leaguePoints} LP`;

            const lpDiff = computeLpDiff(
              lastKnownMatch?.tier,
              lastKnownMatch?.rank ?? "",
              lastKnownMatch?.league_points,
              soloQ.tier,
              soloQ.rank,
              soloQ.leaguePoints,
            );

            if (lpDiff) {
              lpChangeForMatch = lpDiff.lpChange;
              lpChangeText = lpDiff.lpChangeText;
            }
          } else {
            logger.warn(
              `[Riot Polling] soloQ is null for ${player.riot_id}, falling back to Unranked.`,
            );
          }

          const participant = matchData.info.participants.find(
            (p: any) => p.puuid === player.puuid,
          );

          let matchToSave: LoLPlayerMatch | null = null;
          if (participant) {
            const remake = isRemake(
              matchData.info.gameDuration,
              participant.gameEndedInEarlySurrender,
            );

            matchToSave = {
              puuid: player.puuid,
              match_id: latestMatchId,
              kills: participant.kills,
              deaths: participant.deaths,
              assists: participant.assists,
              win: participant.win ? 1 : 0,
              duration: matchData.info.gameDuration,
              is_remake: remake ? 1 : 0,
              timestamp: matchData.info.gameCreation,
              lp_change: lpChangeForMatch,
              raw_json: JSON.stringify(matchData),
            };
          }

          saveMatchAndUpdateLastMatch(matchToSave, {
            puuid: player.puuid,
            matchId: latestMatchId,
            tier: soloQ ? soloQ.tier : null,
            rank: soloQ ? soloQ.rank : null,
            leaguePoints: soloQ ? soloQ.leaguePoints : null,
          });

          const streak = getPlayerStreak(player.puuid);
          const subs = getSubscriptionsForLoLPlayer(player.puuid);
          const embed = buildLoLLiveEmbed(
            matchData,
            player.puuid,
            player.riot_id,
            regionData.opgg,
            rankText,
            lpChangeText,
            streak,
          );

          for (const sub of subs) {
            const messageId = await sendLoLMatchNotification(
              client,
              sub.channel_id,
              embed,
            );
            if (messageId) {
              logger.info(
                `[Riot Polling] Notification sent for ${player.riot_id} to channel ${sub.channel_id}`,
              );
            }
          }
        }
      }
    } catch (error) {
      logger.error("[Riot Polling] Critical Error:", error);
    } finally {
      shouldSkipPolling = false;
    }
  }, env.RIOT_POLL_INTERVAL_MS);
}
