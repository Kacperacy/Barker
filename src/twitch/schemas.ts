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

const twitchGameSchema = z.object({ id: z.string() }).passthrough();
export const twitchGamesResponseSchema = z
  .object({ data: z.array(twitchGameSchema) })
  .passthrough();

const eventSubSubscriptionSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    condition: z.object({ broadcaster_user_id: z.string() }).passthrough(),
  })
  .passthrough();
export const eventSubSubscriptionsResponseSchema = z
  .object({ data: z.array(eventSubSubscriptionSchema) })
  .passthrough();
