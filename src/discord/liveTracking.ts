import type { Client } from "discord.js";
import type { Platform } from "../types";
import {
  clearLiveAnnouncementsForStreamer,
  getLiveAnnouncement,
  getLiveAnnouncementsForStreamer,
  saveLiveAnnouncement,
} from "../database/repositories/liveAnnouncements";
import { editMessageToOffline, sendStreamNotification } from "./delivery";

export interface AnnounceLiveParams {
  client: Client;
  guildId: string;
  channelId: string;
  platform: Platform;
  streamerLogin: string;
  streamerName: string;
  categoryId?: string;
  categoryName?: string;
  stream: any;
  customMessage: string | null | undefined;
  defaultTemplate: string;
}

// Returns whether a new announcement was sent (false = already live, skipped).
export async function announceIfNewlyLive(
  params: AnnounceLiveParams,
): Promise<boolean> {
  const categoryId = params.categoryId ?? null;

  const existing = getLiveAnnouncement(
    params.guildId,
    params.channelId,
    params.streamerLogin,
    categoryId,
    params.platform,
  );
  if (existing) return false;

  const messageId = await sendStreamNotification(
    params.client,
    params.channelId,
    params.platform,
    params.stream,
    params.streamerName,
    params.categoryName,
    params.customMessage,
    params.defaultTemplate,
  );
  if (!messageId) return false;

  saveLiveAnnouncement(
    params.guildId,
    params.channelId,
    params.streamerLogin,
    categoryId,
    params.streamerName,
    messageId,
    params.platform,
  );
  return true;
}

export interface RetireLiveParams {
  client: Client;
  platform: Platform;
  streamerLogin: string;
  categoryId?: string;
  broadcasterName?: string;
}

export async function retireLiveAnnouncements(
  params: RetireLiveParams,
): Promise<void> {
  const categoryId = params.categoryId ?? null;
  const rows = getLiveAnnouncementsForStreamer(
    params.streamerLogin,
    categoryId,
    params.platform,
  );

  for (const row of rows) {
    if (row.message_id) {
      await editMessageToOffline(
        params.client,
        row.channel_id,
        row.message_id,
        params.platform,
        params.broadcasterName ?? row.streamer_name ?? params.streamerLogin,
        params.streamerLogin,
      );
    }
  }

  clearLiveAnnouncementsForStreamer(
    params.streamerLogin,
    categoryId,
    params.platform,
  );
}
