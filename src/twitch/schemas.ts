import { z } from "zod";

const twitchUserSchema = z.object({ id: z.string() }).passthrough();
export const twitchUsersResponseSchema = z
  .object({ data: z.array(twitchUserSchema) })
  .passthrough();

export const twitchStreamSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    user_login: z.string(),
    user_name: z.string(),
    game_id: z.string().optional(),
    game_name: z.string().optional(),
    title: z.string(),
    viewer_count: z.number(),
    language: z.string(),
    thumbnail_url: z.string(),
  })
  .passthrough();
export const twitchStreamsResponseSchema = z
  .object({
    data: z.array(twitchStreamSchema),
    pagination: z
      .object({ cursor: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

// `stream_id` is what ties a published VOD back to the broadcast the bot
// recorded at go-live; without it there is no reliable way to tell which
// archive a video belongs to.
export const twitchVideoSchema = z
  .object({
    id: z.string(),
    stream_id: z.string().nullable().optional(),
    title: z.string().optional(),
    created_at: z.string().optional(),
    duration: z.string().optional(),
  })
  .passthrough();
export const twitchVideosResponseSchema = z
  .object({
    data: z.array(twitchVideoSchema),
    pagination: z
      .object({ cursor: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const twitchGameSchema = z.object({ id: z.string() }).passthrough();
export const twitchGamesResponseSchema = z
  .object({ data: z.array(twitchGameSchema) })
  .passthrough();

export const eventSubSubscriptionSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    status: z.string(),
    condition: z.object({ broadcaster_user_id: z.string() }).passthrough(),
    transport: z
      .object({ method: z.string(), session_id: z.string().optional() })
      .passthrough(),
  })
  .passthrough();
export const eventSubSubscriptionsResponseSchema = z
  .object({
    data: z.array(eventSubSubscriptionSchema),
    pagination: z
      .object({ cursor: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
