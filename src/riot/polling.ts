import { Client, TextChannel } from "discord.js";
import {
  getLatestMatchId,
  getMatchDetails,
  REGIONS,
  getLeagueData,
} from "./api";
import { logger } from "../utils/logger";
import {
  getAllUniqueLoLPlayers,
  getLastMatch,
  updateLastMatch,
  getSubscriptionsForLoLPlayer,
  saveLoLPlayerMatch,
  getPlayerStreak,
} from "../database/repositories/lolSubscriptions";
import { buildLoLLiveEmbed } from "../discord/notifier";

let shouldSkipPolling = false;

function capitalizeFirst(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function getAbsoluteLp(tier: string, rank: string, lp: number): number {
  if (!tier) return 0;

  const TIER_VALUES: Record<string, number> = {
    IRON: 0,
    BRONZE: 400,
    SILVER: 800,
    GOLD: 1200,
    PLATINUM: 1600,
    EMERALD: 2000,
    DIAMOND: 2400,
    MASTER: 2800,
    GRANDMASTER: 2800,
    CHALLENGER: 2800,
  };
  const RANK_VALUES: Record<string, number> = {
    IV: 0,
    III: 100,
    II: 200,
    I: 300,
  };

  const upperTier = tier.toUpperCase();
  const base = TIER_VALUES[upperTier] || 0;

  if (["MASTER", "GRANDMASTER", "CHALLENGER"].includes(upperTier)) {
    return base + lp;
  }

  const rankBase = RANK_VALUES[rank.toUpperCase()] || 0;
  return base + rankBase + lp;
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

          // Filter to only notify and process Ranked Solo/Duo (queueId === 420)
          if (matchData.info.queueId !== 420) {
            logger.info(
              `[Riot Polling] Match ${latestMatchId} is not Solo/Duo Ranked. Skipping notification.`,
            );
            updateLastMatch(
              player.puuid,
              latestMatchId,
              lastKnownMatch?.tier || null,
              lastKnownMatch?.rank || null,
              lastKnownMatch?.league_points ?? null,
            );
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

            if (lastKnownMatch && lastKnownMatch.tier) {
              const oldAbsLp = getAbsoluteLp(
                lastKnownMatch.tier,
                lastKnownMatch.rank,
                lastKnownMatch.league_points || 0,
              );
              const newAbsLp = getAbsoluteLp(
                soloQ.tier,
                soloQ.rank,
                soloQ.leaguePoints,
              );

              lpChangeForMatch = newAbsLp - oldAbsLp;

              if (lpChangeForMatch > 0)
                lpChangeText = ` (+${lpChangeForMatch})`;
              else if (lpChangeForMatch < 0)
                lpChangeText = ` (${lpChangeForMatch})`;
              else lpChangeText = ` (+0)`;
            }
          } else {
            logger.warn(
              `[Riot Polling] soloQ is null for ${player.riot_id}, falling back to Unranked.`,
            );
          }

          const participant = matchData.info.participants.find(
            (p: any) => p.puuid === player.puuid,
          );

          if (participant) {
            const isRemake =
              participant.gameEndedInEarlySurrender ||
              matchData.info.gameDuration < 300;

            saveLoLPlayerMatch({
              puuid: player.puuid,
              match_id: latestMatchId,
              kills: participant.kills,
              deaths: participant.deaths,
              assists: participant.assists,
              win: participant.win ? 1 : 0,
              duration: matchData.info.gameDuration,
              is_remake: isRemake ? 1 : 0,
              timestamp: matchData.info.gameCreation,
              lp_change: lpChangeForMatch,
              raw_json: JSON.stringify(matchData),
            });
          }

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
        }
      }
    } catch (error) {
      logger.error("[Riot Polling] Critical Error:", error);
    } finally {
      shouldSkipPolling = false;
    }
  }, 120000);
}
