import { z } from "zod";
import { logger } from "../utils/logger";
import { chatLogTargets, flushChatMessages, saveModerationEvent } from "../chat/ingest";
import { findChatMessageSender } from "../database/repositories/chatMessages";

// Kick's own chat client listens on a public Pusher socket, and it is the only
// place Kick reports what its webhooks leave out: a moderator deleting a
// message, lifting a ban, or clearing the chat. It is undocumented, so it is used
// for exactly those three and nothing else — messages and bans keep coming from
// the signed webhooks (kick/webhooks.ts), which carry the reason and moderator
// this socket would not.
//
// Read-only and anonymous: public chatroom channels need no auth.
export const KICK_PUSHER_URL =
  "wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false";
const CHANNEL_URL = "https://kick.com/api/v2/channels";
const INITIAL_RECONNECT_DELAY = 5000;
const MAX_RECONNECT_DELAY = 300000;
// A channel whose chatroom could not be resolved is retried on this cadence
// rather than dropped for the life of the process.
const RESOLVE_RETRY_MS = 10 * 60 * 1000;

export interface KickSocketLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

const userSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional(),
    username: z.string().optional(),
    slug: z.string().optional(),
  })
  .passthrough();

const messageDeletedSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  message: z.object({ id: z.string() }),
  aiModerated: z.boolean().optional(),
});

const userUnbannedSchema = z.object({
  id: z.union([z.string(), z.number()]),
  user: userSchema,
  unbanned_by: userSchema.nullish(),
});

const chatroomClearSchema = z.object({
  id: z.union([z.string(), z.number()]),
});

const channelSchema = z.object({ chatroom: z.object({ id: z.number() }) });

export type KickSocketOutcome = "message_delete" | "unban" | "chat_clear" | "ignored";

function login(user: z.infer<typeof userSchema> | null | undefined): string | null {
  const name = user?.slug ?? user?.username;
  return name ? name.toLowerCase() : null;
}

function parseData(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// One socket frame for one channel, stored if it is one of the three events this
// source is for. Split from the socket so the mapping is tested on real payloads.
export function handleKickSocketEvent(
  slug: string,
  event: string,
  rawData: unknown,
  now: string = new Date().toISOString(),
): KickSocketOutcome {
  const data = parseData(rawData);

  if (event === "App\\Events\\MessageDeletedEvent") {
    const parsed = messageDeletedSchema.safeParse(data);
    if (!parsed.success) return "ignored";
    const messageId = parsed.data.message.id;

    // The message may still be in the one-second write buffer.
    flushChatMessages();
    const sender = findChatMessageSender("kick", messageId);

    saveModerationEvent({
      platform: "kick",
      // Keyed by the message, so a redelivery or a second deletion of the same
      // message is one row.
      eventId: `delete:${messageId}`,
      broadcasterLogin: slug,
      createdAt: now,
      action: "message_delete",
      targetMessageId: messageId,
      targetUserId: sender?.userId ?? null,
      targetLogin: sender?.login ?? null,
      targetDisplay: sender?.display ?? null,
      reason: parsed.data.aiModerated ? "AI moderation" : null,
    });
    return "message_delete";
  }

  if (event === "App\\Events\\UserUnbannedEvent") {
    const parsed = userUnbannedSchema.safeParse(data);
    if (!parsed.success) return "ignored";

    saveModerationEvent({
      platform: "kick",
      eventId: `unban:${parsed.data.id}`,
      broadcasterLogin: slug,
      createdAt: now,
      action: "unban",
      targetUserId: parsed.data.user.id === undefined ? null : String(parsed.data.user.id),
      targetLogin: login(parsed.data.user),
      targetDisplay: parsed.data.user.username ?? null,
      actorLogin: login(parsed.data.unbanned_by),
    });
    return "unban";
  }

  if (event === "App\\Events\\ChatroomClearEvent") {
    const parsed = chatroomClearSchema.safeParse(data);
    if (!parsed.success) return "ignored";

    saveModerationEvent({
      platform: "kick",
      eventId: `clear:${parsed.data.id}`,
      broadcasterLogin: slug,
      createdAt: now,
      action: "chat_clear",
    });
    return "chat_clear";
  }

  return "ignored";
}

// The chatroom id is not in Kick's public API, only in the channel endpoint its
// own site reads.
export async function fetchKickChatroomId(
  slug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const res = await fetchImpl(`${CHANNEL_URL}/${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Barker chat log)" },
    });
    if (!res.ok) {
      logger.error(`[Kick socket] chatroom lookup for ${slug} answered ${res.status}`);
      return null;
    }
    const parsed = channelSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.chatroom.id : null;
  } catch (error) {
    logger.error(`[Kick socket] chatroom lookup for ${slug} failed:`, error);
    return null;
  }
}

let socket: KickSocketLike | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let resolveTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = INITIAL_RECONNECT_DELAY;
let stopped = false;
// Pusher channel name → channel slug.
const rooms = new Map<string, string>();

export interface KickChatSocketDeps {
  createSocket?: (url: string) => KickSocketLike;
  listChannels?: () => string[];
  resolveChatroom?: (slug: string) => Promise<number | null>;
}

let createSocket: (url: string) => KickSocketLike = (url) =>
  new WebSocket(url) as unknown as KickSocketLike;

function roomName(chatroomId: number): string {
  return `chatrooms.${chatroomId}.v2`;
}

function subscribe(current: KickSocketLike, channel: string): void {
  current.send(JSON.stringify({ event: "pusher:subscribe", data: { auth: "", channel } }));
}

function dropConnection(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const current = socket;
  socket = null;
  if (!current) return;
  current.onopen = null;
  current.onmessage = null;
  current.onerror = null;
  current.onclose = null;
  try {
    current.close();
  } catch {
    // ignore: a socket that cannot close is already gone
  }
}

function scheduleReconnect(): void {
  if (stopped || reconnectTimer) return;
  logger.info(`[Kick socket] reconnecting in ${reconnectDelay / 1000}s`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectTimer.unref?.();
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

function connect(): void {
  if (stopped || rooms.size === 0) return;

  let current: KickSocketLike;
  try {
    current = createSocket(KICK_PUSHER_URL);
  } catch (error) {
    logger.error("[Kick socket] connection failed:", error);
    scheduleReconnect();
    return;
  }
  socket = current;

  current.onopen = () => {
    if (socket !== current) return;
    reconnectDelay = INITIAL_RECONNECT_DELAY;
    for (const channel of rooms.keys()) subscribe(current, channel);
    logger.info(`[Kick socket] listening to ${[...rooms.values()].join(", ")}`);
  };

  current.onmessage = (event) => {
    if (socket !== current) return;
    let frame: { event?: unknown; channel?: unknown; data?: unknown };
    try {
      frame = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (frame.event === "pusher:ping") {
      current.send(JSON.stringify({ event: "pusher:pong", data: {} }));
      return;
    }
    if (typeof frame.event !== "string" || typeof frame.channel !== "string") return;
    const slug = rooms.get(frame.channel);
    if (!slug) return;
    handleKickSocketEvent(slug, frame.event, frame.data);
  };

  current.onerror = (error) => {
    logger.error("[Kick socket] socket error:", error);
  };

  current.onclose = () => {
    if (socket !== current) return;
    dropConnection();
    scheduleReconnect();
  };
}

// Resolves each Kick channel's chatroom and connects. Channels whose chatroom
// cannot be resolved yet are retried later and joined on the open socket.
export async function startKickChatSocket(deps: KickChatSocketDeps = {}): Promise<string[]> {
  stopped = false;
  if (deps.createSocket) createSocket = deps.createSocket;
  const resolve = deps.resolveChatroom ?? ((slug: string) => fetchKickChatroomId(slug));
  const channels =
    deps.listChannels?.() ??
    chatLogTargets()
      .filter((target) => target.platform === "kick")
      .map((target) => target.login);

  if (channels.length === 0) return [];

  const pending: string[] = [];
  for (const slug of channels) {
    const id = await resolve(slug);
    if (id === null) pending.push(slug);
    else rooms.set(roomName(id), slug);
  }

  if (pending.length > 0 && !stopped) {
    logger.error(`[Kick socket] no chatroom yet for ${pending.join(", ")}; retrying later`);
    resolveTimer = setTimeout(() => {
      resolveTimer = null;
      void retryPending(pending, resolve);
    }, RESOLVE_RETRY_MS);
    resolveTimer.unref?.();
  }

  if (!socket) connect();
  return channels;
}

async function retryPending(
  pending: string[],
  resolve: (slug: string) => Promise<number | null>,
): Promise<void> {
  if (stopped) return;
  const still: string[] = [];
  for (const slug of pending) {
    const id = await resolve(slug);
    if (id === null) {
      still.push(slug);
      continue;
    }
    const name = roomName(id);
    rooms.set(name, slug);
    if (socket) subscribe(socket, name);
  }
  if (!socket) connect();
  if (still.length > 0 && !stopped) {
    resolveTimer = setTimeout(() => {
      resolveTimer = null;
      void retryPending(still, resolve);
    }, RESOLVE_RETRY_MS);
    resolveTimer.unref?.();
  }
}

export function stopKickChatSocket(): void {
  stopped = true;
  if (resolveTimer) {
    clearTimeout(resolveTimer);
    resolveTimer = null;
  }
  dropConnection();
  rooms.clear();
  reconnectDelay = INITIAL_RECONNECT_DELAY;
}
