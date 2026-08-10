import {
  getTwitchCategoryId as getTwitchCategoryIdDefault,
  getTwitchUserId as getTwitchUserIdDefault,
  unsubscribeFromStreamerEvents,
} from "../twitch/api";
import { subscribeToStreamer as subscribeToStreamerDefault } from "../twitch/eventsub";
import {
  addSubscription,
  getSubscriptionsForStreamer,
  removeSubscription,
  updateSubscriptionMessage,
} from "../database/repositories/subscriptions";
import {
  addCategorySubscription as addCategorySubscriptionRow,
  updateCategorySubscriptionMessage as updateCategorySubscriptionMessageRow,
} from "../database/repositories/categorySubscriptions";

export type AddStreamerSubscriptionResult =
  | { ok: true }
  | { ok: false; error: string };

// getTwitchUserId/subscribeToStreamer are injectable (defaults: the real
// Twitch client/EventSub) so tests can pass fakes instead of module-mocking
// — see kick/auth.ts for why that's fragile across bun versions/file order.
export async function addStreamerSubscription(
  guildId: string,
  channelId: string,
  username: string,
  customMessage: string | null,
  getTwitchUserId: (
    username: string,
  ) => Promise<string | null> = getTwitchUserIdDefault,
  subscribeToStreamer: (
    username: string,
  ) => Promise<void> = subscribeToStreamerDefault,
): Promise<AddStreamerSubscriptionResult> {
  const userId = await getTwitchUserId(username);
  if (!userId) {
    return {
      ok: false,
      error: `Could not find Twitch streamer **${username}**.`,
    };
  }

  addSubscription(guildId, channelId, username, customMessage, "twitch");
  await subscribeToStreamer(username);
  return { ok: true };
}

export async function removeStreamerSubscription(
  guildId: string,
  username: string,
): Promise<void> {
  removeSubscription(guildId, username, "twitch");

  const remainingSubs = getSubscriptionsForStreamer(username, "twitch");
  if (remainingSubs.length === 0) {
    await unsubscribeFromStreamerEvents(username);
  }
}

export type AddCategorySubscriptionResult =
  | { ok: true; categoryId: string }
  | { ok: false; error: string };

export async function addCategorySubscription(
  guildId: string,
  channelId: string,
  categoryName: string,
  language: string,
  customMessage: string | null,
  getTwitchCategoryId: (
    name: string,
  ) => Promise<string | null> = getTwitchCategoryIdDefault,
): Promise<AddCategorySubscriptionResult> {
  const categoryId = await getTwitchCategoryId(categoryName);
  if (!categoryId) {
    return { ok: false, error: `Could not find category **${categoryName}**.` };
  }

  addCategorySubscriptionRow(
    guildId,
    channelId,
    categoryId,
    categoryName,
    language,
    customMessage,
    "twitch",
  );
  return { ok: true, categoryId };
}

export function updateStreamerMessage(
  guildId: string,
  username: string,
  customMessage: string,
): void {
  updateSubscriptionMessage(guildId, username, customMessage, "twitch");
}

export function updateCategoryMessage(
  guildId: string,
  categoryName: string,
  language: string,
  customMessage: string,
): void {
  updateCategorySubscriptionMessageRow(
    guildId,
    categoryName,
    language,
    customMessage,
    "twitch",
  );
}
