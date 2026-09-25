import { z } from "zod";
import { env } from "../config";
import { logger } from "../utils/logger";
import { chatLogTargets, isChatLoggingEnabled } from "../chat/ingest";
import { getTwitchArchiveVideos, getTwitchUserId } from "../twitch/api";
import { syncRecordings, type NewRecording } from "../database/repositories/recordings";
import type { Platform } from "../types";

// Keeps the recordings table in step with each platform's own list of VODs for
// the logged channels:
//   Kick   — kick.com/api/v2/channels/<slug>/videos, the endpoint Kick's site
//            reads (the public API has no VODs); it lists what Kick still keeps.
//   Twitch — Helix GET /videos?type=archive (official), kept 7–60 days.
// A failed read changes nothing; only a successful one can mark a recording gone.

const KICK_VIDEOS_URL = "https://kick.com/api/v2/channels";

const kickVideoSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    start_time: z.string(),
    duration: z.number(),
    source: z.string().nullish(),
    session_title: z.string().nullish(),
    views: z.number().nullish(),
    thumbnail: z.object({ src: z.string().nullish() }).nullish(),
    categories: z.array(z.object({ name: z.string() })).nullish(),
  })
  .passthrough();

// Kick writes "2026-09-24 16:57:47" in UTC without saying so.
export function kickTime(value: string): string {
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Date(iso).toISOString();
}

// Twitch durations: "3h8m33s", "45m2s", "59s".
export function twitchDuration(value: string): number {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value.trim());
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

export function fromKick(raw: unknown[], slug: string): NewRecording[] {
  const list: NewRecording[] = [];
  for (const entry of raw) {
    const parsed = kickVideoSchema.safeParse(entry);
    if (!parsed.success) continue;
    const video = parsed.data;
    list.push({
      platform: "kick",
      videoId: String(video.id),
      channelLogin: slug,
      streamId: String(video.id),
      title: video.session_title ?? null,
      category: video.categories?.[0]?.name ?? null,
      startedAt: kickTime(video.start_time),
      durationSeconds: video.duration / 1000,
      sourceUrl: video.source ?? null,
      thumbnailUrl: video.thumbnail?.src ?? null,
      views: video.views ?? null,
    });
  }
  return list;
}

async function readKick(slug: string, fetchImpl: typeof fetch): Promise<NewRecording[] | null> {
  try {
    const res = await fetchImpl(`${KICK_VIDEOS_URL}/${encodeURIComponent(slug)}/videos`, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Barker recordings)" },
    });
    if (!res.ok) {
      logger.error(`[Recordings] Kick list for ${slug} answered ${res.status}`);
      return null;
    }
    const body: unknown = await res.json();
    return Array.isArray(body) ? fromKick(body, slug) : null;
  } catch (error) {
    logger.error(`[Recordings] Kick list for ${slug} failed:`, error);
    return null;
  }
}

async function readTwitch(login: string): Promise<NewRecording[] | null> {
  const userId = await getTwitchUserId(login);
  if (!userId) return null;
  const videos = await getTwitchArchiveVideos(userId);
  if (!videos) return null;
  return videos.map((video) => ({
    platform: "twitch" as const,
    videoId: video.id,
    channelLogin: login,
    streamId: video.stream_id ?? null,
    title: video.title,
    startedAt: new Date(video.created_at).toISOString(),
    durationSeconds: twitchDuration(video.duration),
    thumbnailUrl: video.thumbnail_url?.replace("%{width}", "640").replace("%{height}", "360") ?? null,
    views: video.view_count ?? null,
  }));
}

export interface RecordingSyncDeps {
  fetchImpl?: typeof fetch;
  readTwitch?: (login: string) => Promise<NewRecording[] | null>;
}

export async function syncRecordingsOnce(deps: RecordingSyncDeps = {}): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  for (const target of chatLogTargets()) {
    const list =
      target.platform === "kick"
        ? await readKick(target.login, fetchImpl)
        : await (deps.readTwitch ?? readTwitch)(target.login);
    if (list === null) continue;
    const result = syncRecordings(target.platform as Platform, target.login, list);
    if (result.gone > 0) {
      logger.info(
        `[Recordings] ${target.platform}:${target.login}: ${result.gone} recording(s) no longer listed`,
      );
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function syncRecordingsSafely(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await syncRecordingsOnce();
  } catch (error) {
    logger.error("[Recordings] sync failed:", error);
  } finally {
    running = false;
  }
}

export function startRecordingSync(): void {
  if (!isChatLoggingEnabled() || timer) return;
  void syncRecordingsSafely();
  timer = setInterval(() => void syncRecordingsSafely(), env.RECORDING_SYNC_INTERVAL_MS);
  timer.unref?.();
}
