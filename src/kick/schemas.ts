import { z } from "zod";

export const kickTokenResponseSchema = z
  .object({
    access_token: z.string(),
    token_type: z.string().optional(),
    expires_in: z.coerce.number(),
  })
  .passthrough();

const kickCategorySummarySchema = z
  .object({
    id: z.number(),
    name: z.string(),
    thumbnail: z.string().optional(),
  })
  .passthrough();

const kickChannelStreamSchema = z
  .object({
    is_live: z.boolean(),
    viewer_count: z.number().optional(),
    start_time: z.string().optional(),
    language: z.string().optional(),
  })
  .passthrough();

export const kickChannelSchema = z
  .object({
    broadcaster_user_id: z.number(),
    slug: z.string(),
    stream_title: z.string().optional(),
    category: kickCategorySummarySchema.optional(),
    stream: kickChannelStreamSchema.optional(),
  })
  .passthrough();

export const kickChannelsResponseSchema = z
  .object({ data: z.array(kickChannelSchema) })
  .passthrough();

export const kickCategorySchema = z
  .object({
    id: z.number(),
    name: z.string(),
    tags: z.array(z.string()).optional(),
    thumbnail: z.string().optional(),
  })
  .passthrough();

export const kickCategoriesResponseSchema = z
  .object({
    data: z.array(kickCategorySchema),
    pagination: z
      .object({ next_cursor: z.string().nullable().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const kickBroadcasterUserSchema = z
  .object({
    id: z.number(),
    username: z.string(),
    profile_picture: z.string().optional(),
  })
  .passthrough();

// Shared by both the batch (/public/v1/users/livestreams) and category-wide
// (/public/v2/livestreams) endpoints — their per-item shapes match.
export const kickLivestreamSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    thumbnail: z.string().optional(),
    broadcaster_user: kickBroadcasterUserSchema,
    category: kickCategorySummarySchema,
    channel: z.object({ slug: z.string() }).passthrough(),
    viewer_count: z.number(),
    language_code: z.string(),
    started_at: z.string(),
    tags: z.array(z.string()).optional(),
    has_mature_content: z.boolean().optional(),
  })
  .passthrough();

export const kickUserLivestreamsResponseSchema = z
  .object({ data: z.array(kickLivestreamSchema) })
  .passthrough();

export const kickCategoryLivestreamsResponseSchema = z
  .object({
    data: z.array(kickLivestreamSchema),
    pagination: z
      .object({ next_cursor: z.string().nullable().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
