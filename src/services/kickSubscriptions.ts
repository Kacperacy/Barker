import { getKickBroadcasterId, getKickCategoryId } from "../kick/api";
import {
  addSubscription,
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

export async function addStreamerSubscription(
  guildId: string,
  channelId: string,
  slug: string,
  customMessage: string | null,
): Promise<AddStreamerSubscriptionResult> {
  const broadcasterId = await getKickBroadcasterId(slug);
  if (!broadcasterId) {
    return { ok: false, error: `Could not find Kick streamer **${slug}**.` };
  }

  addSubscription(guildId, channelId, slug, customMessage, "kick");
  return { ok: true };
}

// No EventSub-equivalent to unsubscribe from — kick/streamerPolling.ts reads
// tracked subscriptions directly on every poll, so removing the row here is
// the entire operation.
export function removeStreamerSubscription(
  guildId: string,
  slug: string,
): void {
  removeSubscription(guildId, slug, "kick");
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
  const category = await getKickCategoryId(categoryName);
  if (!category) {
    return { ok: false, error: `Could not find category **${categoryName}**.` };
  }

  addCategorySubscriptionRow(
    guildId,
    channelId,
    category.id,
    category.name,
    language,
    customMessage,
    "kick",
  );
  return { ok: true, categoryId: category.id };
}

export function updateStreamerMessage(
  guildId: string,
  slug: string,
  customMessage: string,
): void {
  updateSubscriptionMessage(guildId, slug, customMessage, "kick");
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
    "kick",
  );
}
