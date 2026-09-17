import type { Platform } from "../types";

export interface LiveBroadcast {
  streamId: string;
  // RFC3339 as the platform reported it (EventSub `started_at`, Kick's
  // `livestream.status.updated` / livestream payload).
  startedAt: string;
}

// Which broadcast is live right now, per (platform, login).
//
// Neither platform tells a chat payload which broadcast it belongs to — Kick's
// chat webhook has no stream id, and Twitch's chat subscription is per channel —
// so the go-live signals this bot already consumes are the only source for it.
// Stamping every message with the stream and its offset from go-live is what
// makes "chat replay beside the VOD" possible later; without it the log is just
// a flat list of messages and the alignment would have to be guessed.
const liveBroadcasts = new Map<string, LiveBroadcast>();

function key(platform: Platform, login: string): string {
  return `${platform}:${login.toLowerCase()}`;
}

export function setLiveBroadcast(
  platform: Platform,
  login: string,
  broadcast: LiveBroadcast,
): void {
  liveBroadcasts.set(key(platform, login), broadcast);
}

export function clearLiveBroadcast(platform: Platform, login: string): void {
  liveBroadcasts.delete(key(platform, login));
}

export function getLiveBroadcast(
  platform: Platform,
  login: string,
): LiveBroadcast | null {
  return liveBroadcasts.get(key(platform, login)) ?? null;
}

// Tests drive several scenarios in one process; the state is process-wide by
// design (the bot is a single process), so they need a way to reset it.
export function resetLiveBroadcasts(): void {
  liveBroadcasts.clear();
}

// Offset of a message from the start of the broadcast it was sent during.
// Returns null when either timestamp is unusable, rather than a zero that would
// read as "sent at go-live" in the replay.
export function offsetSeconds(
  startedAt: string,
  sentAt: string,
): number | null {
  const start = Date.parse(startedAt);
  const sent = Date.parse(sentAt);
  if (Number.isNaN(start) || Number.isNaN(sent)) return null;
  return Math.round((sent - start) / 1000);
}
