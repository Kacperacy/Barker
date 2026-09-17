import { z } from "zod";

export const kickTokenResponseSchema = z
  .object({
    access_token: z.string(),
    // Only the authorization-code flow returns one; the client-credentials flow
    // this bot used before has no refresh token to rotate.
    refresh_token: z.string().optional(),
    token_type: z.string().optional(),
    expires_in: z.coerce.number(),
  })
  .passthrough();

// Response of GET https://api.kick.com/public/v1/public-key — the key a webhook
// signature is verified against.
export const kickPublicKeyResponseSchema = z
  .object({ data: z.object({ public_key: z.string() }).passthrough() })
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

// ---------------------------------------------------------------- webhook payloads
// https://docs.kick.com/events/event-types — the user objects are shared across
// every event, the rest is per event type.

const kickEventUserSchema = z
  .object({
    is_anonymous: z.boolean().optional(),
    user_id: z.number(),
    username: z.string(),
    is_verified: z.boolean().optional(),
    profile_picture: z.string().optional(),
    channel_slug: z.string().optional(),
  })
  .passthrough();

export const kickChatMessageSentEventSchema = z
  .object({
    message_id: z.string(),
    content: z.string(),
    // Added to the payload in July 2025; required here because the log's whole
    // point is ordering messages by when they were sent.
    created_at: z.string(),
    broadcaster: kickEventUserSchema,
    sender: kickEventUserSchema
      .extend({
        identity: z
          .object({
            username_color: z.string().optional(),
            badges: z
              .array(
                z
                  .object({ text: z.string().optional(), type: z.string().optional() })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough(),
    replies_to: z
      .object({ message_id: z.string() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

// Covers both a permanent ban and a timeout: `metadata.expires_at` is null for
// the former and a timestamp for the latter. Kick sends no unban event at all,
// so this is the only moderation signal the platform gives.
export const kickModerationBannedEventSchema = z
  .object({
    broadcaster: kickEventUserSchema,
    moderator: kickEventUserSchema.nullable().optional(),
    banned_user: kickEventUserSchema,
    metadata: z
      .object({
        reason: z.string().nullable().optional(),
        created_at: z.string(),
        expires_at: z.string().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

// Subscribed to as well: it carries go-live/offline, which is what stamps chat
// rows with their broadcast.
export const kickLivestreamStatusEventSchema = z
  .object({
    broadcaster: kickEventUserSchema,
    is_live: z.boolean(),
    title: z.string().nullable().optional(),
    started_at: z.string().nullable().optional(),
    ended_at: z.string().nullable().optional(),
  })
  .passthrough();

// POST /public/v1/events/subscriptions answers per event, with `error` set on
// the ones it refused — a partial failure that must not read as success.
export const kickEventSubscriptionsResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            name: z.string().optional(),
            subscription_id: z.string().optional(),
            version: z.number().optional(),
            error: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
