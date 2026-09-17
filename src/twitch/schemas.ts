import { z } from "zod";

// `login` is optional: the users endpoint returns it, but the schema is also used
// on responses where only the id is read.
const twitchUserSchema = z
  .object({ id: z.string(), login: z.string().optional() })
  .passthrough();
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

// ------------------------------------------------------- chat + moderation payloads
// channel.chat.message v1. The reader is the bot's own user, so the payload
// carries the chatter (who wrote) and the broadcaster (which channel).
export const twitchChatMessageEventSchema = z
  .object({
    broadcaster_user_login: z.string(),
    chatter_user_id: z.string(),
    chatter_user_login: z.string(),
    chatter_user_name: z.string(),
    message_id: z.string(),
    message: z.object({ text: z.string() }).passthrough(),
    color: z.string().optional(),
    badges: z
      .array(
        z
          .object({
            set_id: z.string(),
            id: z.string().optional(),
            info: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    reply: z
      .object({ parent_message_id: z.string() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

// channel.ban / channel.unban v1. A timeout is the same event as a ban with
// `ends_at` set and `is_permanent: false`; there is no separate event for it.
export const twitchBanEventSchema = z
  .object({
    user_id: z.string(),
    user_login: z.string(),
    user_name: z.string(),
    broadcaster_user_login: z.string(),
    moderator_user_login: z.string().optional(),
    reason: z.string().optional(),
    banned_at: z.string().optional(),
    ends_at: z.string().nullable().optional(),
    is_permanent: z.boolean().optional(),
  })
  .passthrough();

// channel.chat.clear v1.
export const twitchChatClearEventSchema = z
  .object({ broadcaster_user_login: z.string() })
  .passthrough();

// channel.chat.clear_user_messages v1.
export const twitchChatClearUserMessagesEventSchema = z
  .object({
    broadcaster_user_login: z.string(),
    target_user_id: z.string(),
    target_user_login: z.string(),
    target_user_name: z.string().optional(),
  })
  .passthrough();

// channel.chat.message_delete v1.
export const twitchChatMessageDeleteEventSchema = z
  .object({
    broadcaster_user_login: z.string(),
    target_user_id: z.string(),
    target_user_login: z.string(),
    target_user_name: z.string().optional(),
    message_id: z.string(),
  })
  .passthrough();

// GET https://id.twitch.tv/oauth2/validate — used at startup to report the scopes
// the stored token actually carries, because a token without user:read:chat
// subscribes to chat and then simply never delivers anything.
export const twitchTokenValidationSchema = z
  .object({
    login: z.string().optional(),
    user_id: z.string().optional(),
    scopes: z.array(z.string()).optional(),
    expires_in: z.number().optional(),
  })
  .passthrough();
