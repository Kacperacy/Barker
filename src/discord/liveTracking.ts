import type { Client } from "discord.js";
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
  streamerLogin: string;
  categoryId?: string;
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
  );
  if (existing) return false;

  const messageId = await sendStreamNotification(
    params.client,
    params.channelId,
    params.stream,
    params.customMessage,
    params.defaultTemplate,
  );
  if (!messageId) return false;

  saveLiveAnnouncement(
    params.guildId,
    params.channelId,
    params.streamerLogin,
    categoryId,
    params.stream?.user_name ?? null,
    messageId,
  );
  return true;
}

export interface RetireLiveParams {
  client: Client;
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
  );

  for (const row of rows) {
    if (row.message_id) {
      await editMessageToOffline(
        params.client,
        row.channel_id,
        row.message_id,
        params.broadcasterName ?? row.streamer_name ?? params.streamerLogin,
        params.streamerLogin,
      );
    }
  }

  clearLiveAnnouncementsForStreamer(params.streamerLogin, categoryId);
}
