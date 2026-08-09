import { getTwitchCategoryId, unsubscribeFromStreamerEvents } from "../twitch/api";
import { subscribeToStreamer } from "../twitch/eventsub";
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

export async function addStreamerSubscription(
  guildId: string,
  channelId: string,
  username: string,
  customMessage: string | null,
): Promise<void> {
  addSubscription(guildId, channelId, username, customMessage);
  await subscribeToStreamer(username);
}

export async function removeStreamerSubscription(
  guildId: string,
  username: string,
): Promise<void> {
  removeSubscription(guildId, username);

  const remainingSubs = getSubscriptionsForStreamer(username);
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
  );
  return { ok: true, categoryId };
}

export function updateStreamerMessage(
  guildId: string,
  username: string,
  customMessage: string,
): void {
  updateSubscriptionMessage(guildId, username, customMessage);
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
  );
}
