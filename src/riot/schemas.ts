import { z } from "zod";

export const accountDtoSchema = z
  .object({
    puuid: z.string(),
    gameName: z.string(),
    tagLine: z.string(),
  })
  .passthrough();

export const matchIdsSchema = z.array(z.string());

const participantSchema = z
  .object({
    puuid: z.string(),
    kills: z.number(),
    deaths: z.number(),
    assists: z.number(),
    win: z.boolean(),
    championId: z.number(),
    championName: z.string(),
    teamPosition: z.string(),
    visionScore: z.number(),
    totalMinionsKilled: z.number(),
    neutralMinionsKilled: z.number(),
    gameEndedInEarlySurrender: z.boolean().optional(),
  })
  .passthrough();

const matchInfoSchema = z
  .object({
    queueId: z.number(),
    platformId: z.string().optional(),
    gameDuration: z.number(),
    gameCreation: z.number(),
    participants: z.array(participantSchema),
  })
  .passthrough();

const matchMetadataSchema = z
  .object({
    matchId: z.string(),
  })
  .passthrough();

export const matchDtoSchema = z
  .object({
    metadata: matchMetadataSchema,
    info: matchInfoSchema,
  })
  .passthrough();

export const leagueEntrySchema = z
  .object({
    queueType: z.string(),
    tier: z.string(),
    rank: z.string(),
    leaguePoints: z.number(),
  })
  .passthrough();

export const leagueEntriesSchema = z.array(leagueEntrySchema);
