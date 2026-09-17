import type { Database } from "bun:sqlite";
import { env } from "../config";
import { logger } from "../utils/logger";
import type { Platform } from "../types";
import { db as defaultDb } from "../database/connection";
import {
  listChatMessages,
  type ChatMessageRow,
} from "../database/repositories/chatMessages";
import {
  listModerationEvents,
  type ModerationAction,
  type ModerationEventRow,
} from "../database/repositories/moderationEvents";
import { chatStats, moderationStats } from "../database/repositories/chatStats";
import { chatLogTargets, isChatLoggingEnabled } from "../chat/ingest";
import { handleKickWebhookRequest, type KickWebhookDeps } from "../kick/webhooks";

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

function platformParam(url: URL): Platform | undefined {
  const value = url.searchParams.get("platform");
  if (value === "twitch" || value === "kick") return value;
  return undefined;
}

function intParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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

  // Which channels are configured, so the subpage can build its channel switch
  // from the server's own list instead of hardcoding it.
  if (url.pathname === "/api/chat/targets") {
    return json({ enabled: isChatLoggingEnabled(), channels: chatLogTargets() });
  }

  if (url.pathname === "/api/chat/messages") {
    const page = listChatMessages(
      {
        platform: platformParam(url),
        login: url.searchParams.get("login") ?? undefined,
        author: url.searchParams.get("author") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
        streamId: url.searchParams.get("streamId") ?? undefined,
        limit: intParam(url, "limit", 100),
        offset: intParam(url, "offset", 0),
      },
      db,
    );

    return json({ ...page, messages: page.messages.map(toApiMessage) });
  }

  if (url.pathname === "/api/moderation/events") {
    const action = url.searchParams.get("action");
    const page = listModerationEvents(
      {
        platform: platformParam(url),
        login: url.searchParams.get("login") ?? undefined,
        action: action ? (action as ModerationAction) : undefined,
        target: url.searchParams.get("target") ?? undefined,
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
        limit: intParam(url, "limit", 100),
        offset: intParam(url, "offset", 0),
      },
      db,
    );

    return json({ ...page, events: page.events.map(toApiModerationEvent) });
  }

  if (url.pathname === "/api/chat/stats") {
    const filter = {
      platform: platformParam(url),
      login: url.searchParams.get("login") ?? undefined,
      days: intParam(url, "days", 30),
    };

    return json({
      chat: chatStats(filter, db),
      moderation: moderationStats(filter, db),
      windowDays: filter.days,
    });
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
