import type { Database } from "bun:sqlite";
import { env } from "../config";
import { logger } from "../utils/logger";
import type { Platform } from "../types";
import { db as defaultDb } from "../database/connection";
import {
  DEFAULT_CHAT_PAGE,
  listChatMessages,
  type ChatMessageRow,
} from "../database/repositories/chatMessages";
import {
  DEFAULT_MODERATION_PAGE,
  listModerationEvents,
  MODERATION_ACTIONS,
  type ModerationAction,
  type ModerationEventRow,
} from "../database/repositories/moderationEvents";
import {
  CHAT_GROUP_BY_VALUES,
  CHAT_METRIC_VALUES,
  DEFAULT_SERIES_LIMIT,
  DEFAULT_STATS_DAYS,
  MAX_SERIES_LIMIT,
  MODERATION_GROUP_BY_VALUES,
  MODERATION_METRIC_VALUES,
  SERIES_ORDER_VALUES,
  chatSeries,
  chatStats,
  moderationSeries,
  moderationStats,
  type ChatGroupBy,
  type ChatMetric,
  type ModerationGroupBy,
  type ModerationMetric,
  type SeriesOrder,
} from "../database/repositories/chatStats";
import {
  DEFAULT_VOD_PAGE,
  listStreamRecorderVods,
  listStoredVodChannels,
  type StreamRecorderVodRow,
} from "../database/repositories/streamRecorderVods";
import { chatLogTargets, isChatLoggingEnabled } from "../chat/ingest";
import { handleKickWebhookRequest, type KickWebhookDeps } from "../kick/webhooks";
import { API_ENDPOINTS, API_VERSION, openapiDocument } from "./openapi";

// The read API is called from the browser through the front end's own proxy, but
// it is left CORS-open too: the data is the channel's public chat, and being able
// to curl it from anywhere is worth more than the (already public) restriction.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Cache-Control": "no-store",
} as const;

export interface ApiDeps {
  db?: Database;
  kick?: KickWebhookDeps;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

// A request that is well-formed but wrong is answered with 400 naming the
// parameter. The alternative — ignoring a value we do not understand — silently
// answers a different question than the one asked, which on a public API is how
// one typo turns into "return everything".
class BadRequest extends Error {}

function invalid(message: string): never {
  throw new BadRequest(message);
}

const PLATFORMS: Platform[] = ["twitch", "kick"];

function enumParam<T extends string>(
  url: URL,
  name: string,
  allowed: readonly T[],
): T | undefined;
function enumParam<T extends string>(
  url: URL,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T;
function enumParam<T extends string>(
  url: URL,
  name: string,
  allowed: readonly T[],
  fallback?: T,
): T | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === "") return fallback;

  const value = raw.trim();
  if (!(allowed as readonly string[]).includes(value)) {
    invalid(`invalid ${name}: expected one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function platformParam(url: URL): Platform | undefined {
  return enumParam<Platform>(url, "platform", PLATFORMS);
}

// Present but not a whole number is a mistake worth reporting; absent is not.
function intParam(
  url: URL,
  name: string,
  fallback: number,
  minimum = 0,
): number {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === "") return fallback;

  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    invalid(`invalid ${name}: expected a whole number`);
  }

  const parsed = Number.parseInt(value, 10);
  if (parsed < minimum) invalid(`invalid ${name}: must be ${minimum} or more`);
  return parsed;
}

function timestampParam(url: URL, name: string): string | undefined {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === "") return undefined;

  const value = raw.trim();
  if (Number.isNaN(Date.parse(value))) {
    invalid(`invalid ${name}: expected an ISO 8601 timestamp`);
  }
  return value;
}

function boolParam(url: URL, name: string, fallback = false): boolean {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === "") return fallback;

  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes") return true;
  if (value === "0" || value === "false" || value === "no") return false;
  invalid(`invalid ${name}: expected a boolean`);
}

// The filters every read endpoint shares, built in one place so they cannot drift
// apart: a new one is added here and reaches all of them.
function commonFilter(url: URL) {
  return {
    platform: platformParam(url),
    login: url.searchParams.get("login") ?? undefined,
    from: timestampParam(url, "from"),
    to: timestampParam(url, "to"),
    streamId: url.searchParams.get("streamId") ?? undefined,
  };
}

function windowFilter(url: URL) {
  return { ...commonFilter(url), days: intParam(url, "days", DEFAULT_STATS_DAYS) };
}

// Rows carry `badges` as JSON text; the API hands the front end a real array so
// it never has to parse a database detail.
function toApiMessage(row: ChatMessageRow) {
  let badges: string[] = [];
  if (row.badges) {
    try {
      const parsed: unknown = JSON.parse(row.badges);
      if (Array.isArray(parsed)) badges = parsed.filter((b): b is string => typeof b === "string");
    } catch {
      badges = [];
    }
  }

  return {
    platform: row.platform,
    id: row.message_id,
    channel: row.broadcaster_login,
    streamId: row.stream_id,
    offsetSeconds: row.offset_seconds,
    sentAt: row.sent_at,
    author: {
      id: row.sender_user_id,
      login: row.sender_login,
      display: row.sender_display,
      color: row.sender_color,
      badges,
    },
    content: row.content,
    replyTo: row.reply_to_message_id,
  };
}

function toApiModerationEvent(row: ModerationEventRow) {
  return {
    platform: row.platform,
    id: row.event_id,
    channel: row.broadcaster_login,
    streamId: row.stream_id,
    action: row.action,
    target: {
      id: row.target_user_id,
      login: row.target_login,
      display: row.target_display,
    },
    actor: row.actor_login,
    reason: row.reason,
    durationMinutes: row.duration_minutes,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

// A StreamRecorder recording as a client sees it: the information their profile
// publishes, kept here so the site does not have to read their HTML. No media is
// stored — `playbackUrl` is a signed URL that expires, and only the recording
// their player is showing has one.
function toApiVod(row: StreamRecorderVodRow) {
  return {
    key: row.key,
    platform: row.platform,
    streamer: row.target,
    title: row.title,
    category: row.category,
    recordedAt: row.recorded_at,
    durationSeconds: row.duration_seconds,
    // Their own word for the state: "live" while recording, "finished" otherwise.
    status: row.status,
    thumbnail: row.thumbnail_url,
    pageUrl: row.page_url,
    playbackUrl: row.playback_url,
    playbackResolvedAt: row.playback_resolved_at,
  };
}


function isAuthorized(request: Request, url: URL): boolean {
  if (!env.READ_API_TOKEN) return true;

  const header = request.headers.get("authorization") ?? "";
  if (
    header.toLowerCase().startsWith("bearer ") &&
    header.slice("bearer ".length).trim() === env.READ_API_TOKEN
  ) {
    return true;
  }

  return url.searchParams.get("token") === env.READ_API_TOKEN;
}

// Split out from the server so the routes can be tested without binding a port.
export async function handleApiRequest(
  request: Request,
  deps: ApiDeps = {},
): Promise<Response> {
  try {
    return await handleRequest(request, deps);
  } catch (error) {
    // A parameter that is present but wrong is the caller's to fix, and saying
    // which one beats a stack trace — or, worse, a silently different answer.
    if (error instanceof BadRequest) return json({ error: error.message }, 400);

    logger.error("[API] request failed:", error);
    return json({ error: "internal error" }, 500);
  }
}

async function handleRequest(
  request: Request,
  deps: ApiDeps,
): Promise<Response> {
  const db = deps.db ?? defaultDb;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (url.pathname === "/health") {
    return json({ ok: true, chatLogging: isChatLoggingEnabled() });
  }

  // Kick's only delivery mechanism. Verified against the signing key inside.
  if (url.pathname === "/webhooks/kick") {
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
    return handleKickWebhookRequest(request, deps.kick);
  }

  if (url.pathname.startsWith("/api/") && !isAuthorized(request, url)) {
    return json({ error: "unauthorized" }, 401);
  }

  // The API describing itself: the index and the OpenAPI document are built from
  // src/web/openapi.ts, so a client can be written against this service without
  // reading its repository.
  if (url.pathname === "/api") {
    return json({
      name: "barker-chat-log",
      version: API_VERSION,
      webhook: "/webhooks/kick",
      openapi: "/api/openapi.json",
      endpoints: API_ENDPOINTS,
    });
  }

  if (url.pathname === "/api/openapi.json") {
    return json(openapiDocument());
  }

  // Which channels are configured for logging. The API is general: a client
  // picks the channels it shows by passing `platform` and `login`.
  if (url.pathname === "/api/chat/targets") {
    return json({
      enabled: isChatLoggingEnabled(),
      channels: chatLogTargets(),
    });
  }

  if (url.pathname === "/api/chat/messages") {
    const page = listChatMessages(
      {
        ...commonFilter(url),
        author: url.searchParams.get("author") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        limit: intParam(url, "limit", DEFAULT_CHAT_PAGE, 1),
        offset: intParam(url, "offset", 0),
      },
      db,
    );

    return json({ ...page, messages: page.messages.map(toApiMessage) });
  }

  if (url.pathname === "/api/moderation/events") {
    const page = listModerationEvents(
      {
        ...commonFilter(url),
        action: enumParam<ModerationAction>(url, "action", MODERATION_ACTIONS),
        target: url.searchParams.get("target") ?? undefined,
        limit: intParam(url, "limit", DEFAULT_MODERATION_PAGE, 1),
        offset: intParam(url, "offset", 0),
      },
      db,
    );

    return json({ ...page, events: page.events.map(toApiModerationEvent) });
  }

  if (url.pathname === "/api/chat/stats") {
    const filter = windowFilter(url);

    return json({
      chat: chatStats(filter, db),
      moderation: moderationStats(filter, db),
      windowDays: filter.days,
    });
  }

  // The same summary for moderation alone, so a caller that cares only about bans
  // does not have to read the chat half of the combined view.
  if (url.pathname === "/api/moderation/stats") {
    const filter = windowFilter(url);
    return json({ moderation: moderationStats(filter, db), windowDays: filter.days });
  }

  // The arbitrary view: the same rows grouped by whatever is asked for, so a
  // chart, an export or a per-broadcast page needs no endpoint of its own.
  // groupBy=channel and groupBy=stream are how a client discovers what is in the
  // log and which broadcasts it covers.
  if (url.pathname === "/api/chat/series") {
    const groupBy = enumParam<ChatGroupBy>(
      url,
      "groupBy",
      CHAT_GROUP_BY_VALUES,
      "day",
    );
    const metric = enumParam<ChatMetric>(
      url,
      "metric",
      CHAT_METRIC_VALUES,
      "messages",
    );
    const order = enumParam<SeriesOrder>(url, "order", SERIES_ORDER_VALUES, "value");
    const limit = Math.min(
      intParam(url, "limit", DEFAULT_SERIES_LIMIT, 1),
      MAX_SERIES_LIMIT,
    );

    const rows = chatSeries(windowFilter(url), { groupBy, metric, order, limit }, db);
    return json({ groupBy, metric, order, limit, count: rows.length, rows });
  }

  if (url.pathname === "/api/moderation/series") {
    const groupBy = enumParam<ModerationGroupBy>(
      url,
      "groupBy",
      MODERATION_GROUP_BY_VALUES,
      "day",
    );
    const metric = enumParam<ModerationMetric>(
      url,
      "metric",
      MODERATION_METRIC_VALUES,
      "events",
    );
    const order = enumParam<SeriesOrder>(url, "order", SERIES_ORDER_VALUES, "value");
    const limit = Math.min(
      intParam(url, "limit", DEFAULT_SERIES_LIMIT, 1),
      MAX_SERIES_LIMIT,
    );

    const rows = moderationSeries(
      windowFilter(url),
      { groupBy, metric, order, limit },
      db,
    );
    return json({ groupBy, metric, order, limit, count: rows.length, rows });
  }

  // StreamRecorder.io's recordings for the tracked channels, newest first. The
  // bot polls their public feed and stores what it finds — this side records
  // nothing (see streamrecorder/polling.ts). `status` is their own word for the
  // recording's state, and `playbackUrl` is only set where a public one exists.
  if (url.pathname === "/api/vods") {
    const page = listStreamRecorderVods(
      {
        platform: platformParam(url),
        target: url.searchParams.get("login") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        from: timestampParam(url, "from"),
        to: timestampParam(url, "to"),
        limit: intParam(url, "limit", DEFAULT_VOD_PAGE, 1),
        offset: intParam(url, "offset", 0),
      },
      db,
    );

    return json({ ...page, vods: page.vods.map(toApiVod) });
  }

  // Which channels have recordings stored, so a client can build a filter without
  // guessing at logins.
  if (url.pathname === "/api/vods/channels") {
    return json({ channels: listStoredVodChannels(db) });
  }

  return json({ error: "not found" }, 404);
}

export function startApiServer() {
  const server = Bun.serve({
    port: env.API_PORT,
    hostname: "0.0.0.0",
    fetch: (request) => handleApiRequest(request),
  });

  logger.info(
    `[API] Listening on :${server.port} (chat logging ${isChatLoggingEnabled() ? "on" : "off"})`,
  );
  if (isChatLoggingEnabled()) {
    const base = env.PUBLIC_BASE_URL || `http://<host>:${env.API_PORT}`;
    logger.info(`[API] Kick webhook endpoint to register: ${base}/webhooks/kick`);
  }

  return server;
}
