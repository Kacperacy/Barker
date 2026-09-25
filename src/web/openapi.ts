import {
  CHAT_GROUP_BY_VALUES,
  CHAT_METRIC_VALUES,
  DEFAULT_SERIES_LIMIT,
  MAX_SERIES_LIMIT,
  MODERATION_GROUP_BY_VALUES,
  MODERATION_METRIC_VALUES,
  SERIES_ORDER_VALUES,
} from "../database/repositories/chatStats";
import {
  DEFAULT_CHAT_PAGE,
  MAX_CHAT_PAGE,
} from "../database/repositories/chatMessages";
import {
  DEFAULT_MODERATION_PAGE,
  MAX_MODERATION_PAGE,
  MODERATION_ACTIONS,
} from "../database/repositories/moderationEvents";

import { DEFAULT_STREAM_PAGE, MAX_STREAM_PAGE } from "../database/repositories/streams";

// The read API's contract, in one place: /api answers the index below and
// /api/openapi.json the document, both built from this module, so the two can
// never advertise different APIs. It is written by hand rather than generated
// from the router — the router is a handful of ifs, and a generator would be
// more machinery than the thing it describes — but every parameter and response
// shape here mirrors src/web/server.ts, and the enum lists come from the same
// constants the handlers validate against.
//
// The API is additive-only: a client built against this document keeps working
// when a parameter, an endpoint or a response field is added, which is what
// makes it safe to build other things on it than the subpage it started as.

export const API_VERSION = "1";

export interface ApiEndpoint {
  method: "GET" | "POST";
  path: string;
  summary: string;
}

// What a client reads first. The recipes matter as much as the list: "what is in
// this log" and "which broadcasts does it cover" are series queries rather than
// endpoints of their own, so the surface stays small as features are added.
export const API_ENDPOINTS: ApiEndpoint[] = [
  {
    method: "GET",
    path: "/health",
    summary: "Liveness, and whether chat logging is on.",
  },
  { method: "GET", path: "/api", summary: "This index." },
  {
    method: "GET",
    path: "/api/openapi.json",
    summary: "OpenAPI 3.1 description of the read API.",
  },
  {
    method: "GET",
    path: "/api/chat/targets",
    summary: "Channels configured for logging.",
  },
  {
    method: "GET",
    path: "/api/chat/messages",
    summary: "Logged messages, newest first, with paging and filters.",
  },
  {
    method: "GET",
    path: "/api/chat/stats",
    summary:
      "Chat totals and buckets plus ban/timeout counts for one window (one call; the subpage's view).",
  },
  {
    method: "GET",
    path: "/api/moderation/stats",
    summary: "Ban and timeout totals, per-day buckets, top targets and actors.",
  },
  {
    method: "GET",
    path: "/api/chat/series",
    summary:
      "Messages or chatters grouped by day, hour, weekday, author, channel, platform or stream. groupBy=channel lists the log's channels, groupBy=stream its broadcasts.",
  },
  {
    method: "GET",
    path: "/api/moderation/events",
    summary: "Bans, timeouts, deletions and chat clears, newest first.",
  },
  {
    method: "GET",
    path: "/api/moderation/series",
    summary:
      "Moderation grouped by day, hour, weekday, target, actor, action, channel, platform or stream.",
  },
  {
    method: "GET",
    path: "/api/streams",
    summary:
      "Broadcasts of the logged channels, newest first, with viewer peak and average and chat/moderation totals.",
  },
  {
    method: "GET",
    path: "/api/streams/viewers",
    summary: "One broadcast's viewer count over time.",
  },
  {
    method: "POST",
    path: "/webhooks/kick",
    summary: "Kick's event delivery. Signature-verified; not a client endpoint.",
  },
];

interface QueryParameter {
  name: string;
  in: "query";
  schema: Record<string, unknown>;
  description: string;
  required?: boolean;
}

const PLATFORM_VALUES = ["twitch", "kick"];

// Every read endpoint speaks the same filter vocabulary, so a client that has
// learned one endpoint has learned the filters of all of them.
export const COMMON_PARAMETERS: QueryParameter[] = [
  {
    name: "platform",
    in: "query",
    schema: { type: "string", enum: PLATFORM_VALUES },
    description: "Restrict to one platform.",
  },
  {
    name: "login",
    in: "query",
    schema: { type: "string" },
    description: "Restrict to one channel: its Twitch login or its Kick slug.",
  },
  {
    name: "from",
    in: "query",
    schema: { type: "string", format: "date-time" },
    description:
      "Inclusive lower bound on the row's own timestamp (ISO 8601). Takes precedence over `days`.",
  },
  {
    name: "to",
    in: "query",
    schema: { type: "string", format: "date-time" },
    description: "Inclusive upper bound on the row's own timestamp (ISO 8601).",
  },
  {
    name: "streamId",
    in: "query",
    schema: { type: "string" },
    description:
      "Restrict to one broadcast, by the streamId its rows carry. Omitted, rows from every broadcast are returned.",
  },
];

// The per-endpoint extras, grouped the way the endpoints group them.
const READ_PARAMETERS = {
  author: {
    name: "author",
    in: "query",
    schema: { type: "string" },
    description: "Restrict to messages sent by one viewer login.",
  },
  q: {
    name: "q",
    in: "query",
    schema: { type: "string" },
    description:
      "Substring match on the message body. `%` and `_` match themselves.",
  },
  action: {
    name: "action",
    in: "query",
    schema: { type: "string", enum: MODERATION_ACTIONS },
    description: "Restrict to one kind of moderation action.",
  },
  target: {
    name: "target",
    in: "query",
    schema: { type: "string" },
    description: "Restrict to actions taken against one viewer login.",
  },
  days: {
    name: "days",
    in: "query",
    schema: { type: "integer", minimum: 0, default: 30 },
    description:
      "Window counted back from now, in days; 0 means everything. Ignored when `from` is given.",
  },
} satisfies Record<string, QueryParameter>;

const PAGING_PARAMETERS = {
  messageLimit: {
    name: "limit",
    in: "query",
    schema: {
      type: "integer",
      minimum: 1,
      maximum: MAX_CHAT_PAGE,
      default: DEFAULT_CHAT_PAGE,
    },
    description: "Page size; clamped to the maximum.",
  },
  moderationLimit: {
    name: "limit",
    in: "query",
    schema: {
      type: "integer",
      minimum: 1,
      maximum: MAX_MODERATION_PAGE,
      default: DEFAULT_MODERATION_PAGE,
    },
    description: "Page size; clamped to the maximum.",
  },
  offset: {
    name: "offset",
    in: "query",
    schema: { type: "integer", minimum: 0, default: 0 },
    description: "Rows to skip, for paging. The response echoes what was applied.",
  },
} satisfies Record<string, QueryParameter>;

const SERIES_PARAMETERS = {
  seriesLimit: {
    name: "limit",
    in: "query",
    schema: {
      type: "integer",
      minimum: 1,
      maximum: MAX_SERIES_LIMIT,
      default: DEFAULT_SERIES_LIMIT,
    },
    description: "Groups to return; clamped to the maximum.",
  },
  chatGroupBy: {
    name: "groupBy",
    in: "query",
    schema: { type: "string", enum: CHAT_GROUP_BY_VALUES, default: "day" },
    description:
      "What the rows are grouped into. `channel` answers what is in the log, `stream` which broadcasts it covers.",
  },
  chatMetric: {
    name: "metric",
    in: "query",
    schema: { type: "string", enum: CHAT_METRIC_VALUES, default: "messages" },
    description: "What is counted per group.",
  },
  moderationGroupBy: {
    name: "groupBy",
    in: "query",
    schema: {
      type: "string",
      enum: MODERATION_GROUP_BY_VALUES,
      default: "day",
    },
    description: "What the rows are grouped into.",
  },
  moderationMetric: {
    name: "metric",
    in: "query",
    schema: {
      type: "string",
      enum: MODERATION_METRIC_VALUES,
      default: "events",
    },
    description: "What is counted per group.",
  },
  order: {
    name: "order",
    in: "query",
    schema: { type: "string", enum: SERIES_ORDER_VALUES, default: "value" },
    description:
      "`value` ranks by the count, `key` reads in group order (chronological for day, hour and weekday).",
  },
} satisfies Record<string, QueryParameter>;

const readParameters = (...extra: (keyof typeof READ_PARAMETERS)[]) => [
  ...COMMON_PARAMETERS,
  ...extra.map((name) => READ_PARAMETERS[name]),
];

// Response shapes, next to the parameters, so a change to a mapper in server.ts
// has one obvious place to be reflected.
const SCHEMAS: Record<string, unknown> = {
  Error: {
    type: "object",
    required: ["error"],
    properties: { error: { type: "string" } },
  },
  Health: {
    type: "object",
    required: ["ok", "chatLogging"],
    properties: { ok: { type: "boolean" }, chatLogging: { type: "boolean" } },
  },
  Channel: {
    type: "object",
    required: ["platform", "login"],
    properties: {
      platform: { type: "string", enum: PLATFORM_VALUES },
      login: { type: "string" },
    },
  },
  Targets: {
    type: "object",
    required: ["enabled", "channels"],
    properties: {
      enabled: {
        type: "boolean",
        description: "Whether chat logging is switched on at all.",
      },
      channels: {
        type: "array",
        items: { $ref: "#/components/schemas/Channel" },
      },
    },
  },
  Author: {
    type: "object",
    required: ["login", "badges"],
    properties: {
      id: { type: ["string", "null"] },
      login: { type: ["string", "null"] },
      display: { type: ["string", "null"] },
      color: { type: ["string", "null"] },
      badges: { type: "array", items: { type: "string" } },
    },
  },
  ChatMessage: {
    type: "object",
    required: ["platform", "id", "channel", "sentAt", "author", "content"],
    properties: {
      platform: { type: "string", enum: PLATFORM_VALUES },
      id: { type: "string", description: "The platform's own message id." },
      channel: { type: "string", description: "The channel this was sent in." },
      streamId: {
        type: ["string", "null"],
        description: "The broadcast it belongs to, when one was being tracked.",
      },
      offsetSeconds: {
        type: ["integer", "null"],
        description: "Seconds into that broadcast.",
      },
      sentAt: {
        type: "string",
        format: "date-time",
        description: "When the platform says it was sent, not when we stored it.",
      },
      author: { $ref: "#/components/schemas/Author" },
      content: { type: "string" },
      replyTo: {
        type: ["string", "null"],
        description: "Message id this replies to, when the platform says so.",
      },
      deleted: {
        type: ["object", "null"],
        description:
          "Set when a moderator removed the message. `by` is null where the platform does not name who (Twitch IRC, Kick's chat socket).",
        properties: {
          at: { type: "string", format: "date-time" },
          by: { type: ["string", "null"] },
        },
      },
    },
  },
  ChatMessagePage: {
    type: "object",
    required: ["messages", "total", "limit", "offset"],
    properties: {
      messages: {
        type: "array",
        items: { $ref: "#/components/schemas/ChatMessage" },
      },
      total: {
        type: "integer",
        description: "Rows matching the filters, before paging.",
      },
      limit: { type: "integer" },
      offset: { type: "integer" },
    },
  },
  ModerationEvent: {
    type: "object",
    required: ["platform", "id", "channel", "action", "createdAt"],
    properties: {
      platform: { type: "string", enum: PLATFORM_VALUES },
      id: { type: "string", description: "From the delivery; the dedupe key." },
      channel: { type: "string" },
      streamId: { type: ["string", "null"] },
      action: { type: "string", enum: MODERATION_ACTIONS },
      target: {
        type: "object",
        properties: {
          id: { type: ["string", "null"] },
          login: { type: ["string", "null"] },
          display: { type: ["string", "null"] },
        },
      },
      targetMessageId: {
        type: ["string", "null"],
        description: "For message_delete: the id of the message that was removed.",
      },
      actor: {
        type: ["string", "null"],
        description:
          "Who acted; null when the platform does not say (Twitch IRC names nobody).",
      },
      reason: { type: ["string", "null"] },
      durationMinutes: {
        type: ["integer", "null"],
        description:
          "Timeout length; null for a permanent ban or an unknown one.",
      },
      expiresAt: {
        type: ["string", "null"],
        format: "date-time",
        description: "When a timeout ends; null for a permanent ban.",
      },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  ModerationEventPage: {
    type: "object",
    required: ["events", "total", "limit", "offset"],
    properties: {
      events: {
        type: "array",
        items: { $ref: "#/components/schemas/ModerationEvent" },
      },
      total: { type: "integer" },
      limit: { type: "integer" },
      offset: { type: "integer" },
    },
  },
  SeriesRow: {
    type: "object",
    required: ["key", "value"],
    properties: {
      key: {
        type: "string",
        description:
          "The group. Always a string, including for hour and weekday; an empty key means the row had nothing to group by (off-stream, unknown author).",
      },
      value: { type: "integer", description: "The metric for this group." },
      firstAt: {
        type: ["string", "null"],
        format: "date-time",
        description: "Earliest row in the group.",
      },
      lastAt: {
        type: ["string", "null"],
        format: "date-time",
        description: "Latest row in the group.",
      },
    },
  },
  ChatSeries: {
    type: "object",
    required: ["groupBy", "metric", "order", "limit", "count", "rows"],
    properties: {
      groupBy: { type: "string", enum: CHAT_GROUP_BY_VALUES },
      metric: { type: "string", enum: CHAT_METRIC_VALUES },
      order: { type: "string", enum: SERIES_ORDER_VALUES },
      limit: { type: "integer", description: "The limit actually applied." },
      count: { type: "integer", description: "Groups returned." },
      rows: { type: "array", items: { $ref: "#/components/schemas/SeriesRow" } },
    },
  },
  ModerationSeries: {
    type: "object",
    required: ["groupBy", "metric", "order", "limit", "count", "rows"],
    properties: {
      groupBy: { type: "string", enum: MODERATION_GROUP_BY_VALUES },
      metric: { type: "string", enum: MODERATION_METRIC_VALUES },
      order: { type: "string", enum: SERIES_ORDER_VALUES },
      limit: { type: "integer" },
      count: { type: "integer" },
      rows: { type: "array", items: { $ref: "#/components/schemas/SeriesRow" } },
    },
  },
  ChatStats: {
    type: "object",
    required: ["totalMessages", "uniqueChatters"],
    properties: {
      totalMessages: { type: "integer" },
      uniqueChatters: { type: "integer" },
      firstMessageAt: { type: ["string", "null"], format: "date-time" },
      lastMessageAt: { type: ["string", "null"], format: "date-time" },
      byDay: {
        type: "array",
        items: {
          type: "object",
          properties: { day: { type: "string" }, messages: { type: "integer" } },
        },
      },
      byHour: {
        type: "array",
        description: "24 buckets, index = UTC hour.",
        items: { type: "integer" },
      },
      topChatters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            login: { type: "string" },
            display: { type: ["string", "null"] },
            messages: { type: "integer" },
          },
        },
      },
    },
  },
  ModerationStats: {
    type: "object",
    required: ["total", "bans", "timeouts"],
    properties: {
      total: { type: "integer" },
      bans: { type: "integer" },
      timeouts: { type: "integer" },
      byDay: {
        type: "array",
        items: {
          type: "object",
          properties: {
            day: { type: "string" },
            bans: { type: "integer" },
            timeouts: { type: "integer" },
          },
        },
      },
      topTargets: {
        type: "array",
        items: {
          type: "object",
          properties: { login: { type: "string" }, count: { type: "integer" } },
        },
      },
      topActors: {
        type: "array",
        items: {
          type: "object",
          properties: { login: { type: "string" }, count: { type: "integer" } },
        },
      },
    },
  },
  ChatStatsResponse: {
    type: "object",
    required: ["chat", "moderation", "windowDays"],
    properties: {
      chat: { $ref: "#/components/schemas/ChatStats" },
      moderation: { $ref: "#/components/schemas/ModerationStats" },
      windowDays: {
        type: "integer",
        description: "The `days` applied; 0 means no lower bound.",
      },
    },
  },
  ModerationStatsResponse: {
    type: "object",
    required: ["moderation", "windowDays"],
    properties: {
      moderation: { $ref: "#/components/schemas/ModerationStats" },
      windowDays: { type: "integer" },
    },
  },
  Stream: {
    type: "object",
    required: ["platform", "id", "channel", "startedAt", "live"],
    properties: {
      platform: { type: "string", enum: PLATFORM_VALUES },
      id: { type: "string", description: "The platform's broadcast id; chat rows carry it as streamId." },
      channel: { type: "string" },
      title: { type: ["string", "null"], description: "Latest title seen; null for streams backfilled from the chat log." },
      category: { type: ["string", "null"] },
      startedAt: { type: "string", format: "date-time" },
      endedAt: {
        type: ["string", "null"],
        format: "date-time",
        description: "Last time the stream was seen live; null while it is live.",
      },
      live: { type: "boolean" },
      durationSeconds: { type: ["integer", "null"] },
      peakViewers: { type: ["integer", "null"] },
      avgViewers: { type: ["integer", "null"] },
      messages: { type: "integer" },
      chatters: { type: "integer" },
      bans: { type: "integer" },
      timeouts: { type: "integer" },
    },
  },
  StreamPage: {
    type: "object",
    required: ["streams", "total", "limit", "offset"],
    properties: {
      streams: { type: "array", items: { $ref: "#/components/schemas/Stream" } },
      total: { type: "integer" },
      limit: { type: "integer" },
      offset: { type: "integer" },
    },
  },
  ViewerSamples: {
    type: "object",
    required: ["platform", "id", "samples"],
    properties: {
      platform: { type: "string", enum: PLATFORM_VALUES },
      id: { type: "string" },
      samples: {
        type: "array",
        items: {
          type: "object",
          required: ["at", "viewers"],
          properties: {
            at: { type: "string", format: "date-time" },
            viewers: { type: "integer" },
          },
        },
      },
    },
  },
  ApiIndex: {
    type: "object",
    required: ["name", "version", "openapi", "endpoints"],
    properties: {
      name: { type: "string" },
      version: { type: "string" },
      webhook: { type: "string" },
      openapi: { type: "string" },
      endpoints: {
        type: "array",
        items: {
          type: "object",
          properties: {
            method: { type: "string" },
            path: { type: "string" },
            summary: { type: "string" },
          },
        },
      },
    },
  },
};

const byName = (name: string): QueryParameter => {
  const found = COMMON_PARAMETERS.find((parameter) => parameter.name === name);
  if (!found) throw new Error(`unknown common parameter: ${name}`);
  return found;
};

// Every read endpoint answers the same way, so one builder covers them all: the
// only things that differ are a summary, the parameters and the schema.
function operation(
  summary: string,
  parameters: QueryParameter[],
  schema: string,
  description?: string,
) {
  const error = {
    description: "Error",
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };

  return {
    summary,
    ...(description === undefined ? {} : { description }),
    parameters,
    responses: {
      "200": {
        description: "OK",
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${schema}` },
          },
        },
      },
      "400": { ...error, description: "A parameter is present but invalid." },
      "401": {
        ...error,
        description: "READ_API_TOKEN is set and the request did not carry it.",
      },
    },
  };
}

// The document, for generating a client rather than reading this file.
export function openapiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Barker chat log",
      version: API_VERSION,
      description:
        "Chat, moderation and aggregated views over the logs Barker collects from Twitch (anonymous IRC) and Kick (webhooks). Additive-only: fields, parameters and endpoints are added, never repurposed. Timestamps are ISO 8601 UTC, timestamp bounds are inclusive, and every read endpoint understands platform, login, from, to, streamId and includeHidden.",
    },
    servers: [{ url: "/" }],
    paths: {
      "/health": {
        get: operation("Liveness and whether chat logging is on", [], "Health"),
      },
      "/api": { get: operation("The endpoint index", [], "ApiIndex") },
      "/api/openapi.json": {
        get: {
          summary: "This document",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": { schema: { type: "object" } },
              },
            },
          },
        },
      },
      "/api/chat/targets": {
        get: operation(
          "Channels configured for logging",
          [],
          "Targets",
          "The configured channels, whether or not they have produced anything yet.",
        ),
      },
      "/api/chat/messages": {
        get: operation(
          "Logged messages",
          [
            ...readParameters("author", "q"),
            PAGING_PARAMETERS.messageLimit,
            PAGING_PARAMETERS.offset,
          ],
          "ChatMessagePage",
          "Newest first, ordered by the platform's send time with the message id as the tie-breaker, so paging cannot repeat or skip a row.",
        ),
      },
      "/api/moderation/events": {
        get: operation(
          "Bans, timeouts, deletions and chat clears",
          [
            ...readParameters("action", "target"),
            PAGING_PARAMETERS.moderationLimit,
            PAGING_PARAMETERS.offset,
          ],
          "ModerationEventPage",
          "Newest first. Twitch's IRC names neither a moderator nor a reason, and Kick sends no unban, so those fields are null rather than invented.",
        ),
      },
      "/api/chat/stats": {
        get: operation(
          "Chat and moderation totals for one window",
          readParameters("days"),
          "ChatStatsResponse",
          "One call for the summary a dashboard opens with. /api/chat/series and /api/moderation/stats answer the two halves separately.",
        ),
      },
      "/api/moderation/stats": {
        get: operation(
          "Moderation totals for one window",
          readParameters("days"),
          "ModerationStatsResponse",
        ),
      },
      "/api/chat/series": {
        get: operation(
          "Chat grouped by a dimension",
          [
            ...readParameters("days"),
            SERIES_PARAMETERS.chatGroupBy,
            SERIES_PARAMETERS.chatMetric,
            SERIES_PARAMETERS.order,
            SERIES_PARAMETERS.seriesLimit,
          ],
          "ChatSeries",
          "The general view: groupBy=channel lists what is in the log, groupBy=stream the broadcasts it covers, both with counts and time bounds.",
        ),
      },
      "/api/moderation/series": {
        get: operation(
          "Moderation grouped by a dimension",
          [
            ...readParameters("days"),
            SERIES_PARAMETERS.moderationGroupBy,
            SERIES_PARAMETERS.moderationMetric,
            SERIES_PARAMETERS.order,
            SERIES_PARAMETERS.seriesLimit,
          ],
          "ModerationSeries",
        ),
      },
      "/api/streams": {
        get: operation(
          "Broadcasts of the logged channels",
          [
            byName("platform"),
            byName("login"),
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: MAX_STREAM_PAGE, default: DEFAULT_STREAM_PAGE },
              description: "Page size; clamped to the maximum.",
            },
            PAGING_PARAMETERS.offset,
          ],
          "StreamPage",
        ),
      },
      "/api/streams/viewers": {
        get: operation(
          "One broadcast's viewer count over time",
          [
            { ...byName("platform"), required: true },
            { name: "id", in: "query", required: true, schema: { type: "string" }, description: "The broadcast id." },
          ],
          "ViewerSamples",
        ),
      },
    },
    components: { schemas: SCHEMAS },
  };
}




