import { env } from "../config";
import { logger } from "../utils/logger";
import { chatLogTargets, isChatLoggingEnabled } from "../chat/ingest";
import { clearLiveBroadcast, setLiveBroadcast } from "../chat/live";
import { getKickBroadcasterId, getKickLivestreamsByBroadcasterIds } from "../kick/api";
import { getStreamData } from "../twitch/api";
import { closeOpenStreams, recordStreamSample } from "../database/repositories/streams";
import type { Platform } from "../types";

// Stream history for the logged channels: every poll records whether each one is
// live, its title and category, and a viewer-count sample.
//
// It is also what tells the chat log which broadcast a message belongs to for
// these channels. That used to come only from the Discord live-announcement
// poller, which skips a channel nobody subscribed to in Discord — so a chat-log
// channel without one had messages with no stream to replay them against.

export interface LiveSnapshot {
  streamId: string;
  title: string | null;
  category: string | null;
  startedAt: string;
  viewers: number;
}

export interface StreamPollDeps {
  // Live state per logged channel; null = offline, undefined = unknown (the
  // lookup failed, so nothing is closed on its account).
  fetchLive?: (platform: Platform, logins: string[]) => Promise<Map<string, LiveSnapshot | null>>;
  now?: () => string;
}

async function fetchKickLive(logins: string[]): Promise<Map<string, LiveSnapshot | null>> {
  const result = new Map<string, LiveSnapshot | null>();
  const idBySlug = new Map<string, string>();
  for (const slug of logins) {
    const id = await getKickBroadcasterId(slug);
    if (id) idBySlug.set(slug, id);
  }
  if (idBySlug.size === 0) return result;

  const live = await getKickLivestreamsByBroadcasterIds([...idBySlug.values()]);
  const bySlug = new Map(live.map((stream) => [stream.channel.slug.toLowerCase(), stream]));
  for (const slug of idBySlug.keys()) {
    const stream = bySlug.get(slug);
    result.set(
      slug,
      stream
        ? {
            streamId: stream.id,
            title: stream.title || null,
            category: stream.category?.name ?? null,
            startedAt: stream.started_at,
            viewers: stream.viewer_count,
          }
        : null,
    );
  }
  return result;
}

async function fetchTwitchLive(logins: string[]): Promise<Map<string, LiveSnapshot | null>> {
  const result = new Map<string, LiveSnapshot | null>();
  for (const login of logins) {
    try {
      const stream = await getStreamData(login);
      result.set(
        login,
        stream
          ? {
              streamId: stream.id,
              title: stream.title || null,
              category: stream.game_name || null,
              startedAt: stream.started_at ?? new Date().toISOString(),
              viewers: stream.viewer_count,
            }
          : null,
      );
    } catch (error) {
      logger.error(`[Streams] Twitch lookup for ${login} failed:`, error);
    }
  }
  return result;
}

function defaultFetchLive(platform: Platform, logins: string[]) {
  return platform === "kick" ? fetchKickLive(logins) : fetchTwitchLive(logins);
}

export async function pollStreamsOnce(deps: StreamPollDeps = {}): Promise<number> {
  const fetchLive = deps.fetchLive ?? defaultFetchLive;
  const now = deps.now ?? (() => new Date().toISOString());
  let recorded = 0;

  for (const platform of ["kick", "twitch"] as Platform[]) {
    const logins = chatLogTargets()
      .filter((target) => target.platform === platform)
      .map((target) => target.login);
    if (logins.length === 0) continue;

    let live: Map<string, LiveSnapshot | null>;
    try {
      live = await fetchLive(platform, logins);
    } catch (error) {
      logger.error(`[Streams] ${platform} poll failed:`, error);
      continue;
    }

    const at = now();
    for (const login of logins) {
      if (!live.has(login)) continue;
      const snapshot = live.get(login) ?? null;
      if (snapshot) {
        setLiveBroadcast(platform, login, {
          streamId: snapshot.streamId,
          startedAt: snapshot.startedAt,
        });
        recordStreamSample({
          platform,
          streamId: snapshot.streamId,
          broadcasterLogin: login,
          title: snapshot.title,
          category: snapshot.category,
          startedAt: snapshot.startedAt,
          viewers: snapshot.viewers,
          at,
        });
        recorded++;
      } else {
        clearLiveBroadcast(platform, login);
        closeOpenStreams(platform, login);
      }
    }
  }

  return recorded;
}

export function startStreamHistoryPolling(): void {
  if (!isChatLoggingEnabled()) return;

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await pollStreamsOnce();
    } catch (error) {
      logger.error("[Streams] Poll failed:", error);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), env.STREAM_HISTORY_POLL_INTERVAL_MS);
  timer.unref?.();
}
