import { createHash } from "node:crypto";
import { logger } from "../utils/logger";
import { chatLogTargets, saveChatMessage, saveModerationEvent } from "../chat/ingest";

// Twitch chat, read the way any outside observer can: an **anonymous** IRC
// connection.
//
// EventSub chat and ban topics are not available to a third party — they need
// `user:read:chat` as the broadcaster, or a bot with `channel:bot` granted — so
// this uses the interface Twitch has always allowed anyone to read a public
// channel with: `PASS SCHMOOPIIE` + `NICK justinfanNNNN`, no account, no token,
// no scopes. It also carries more than plain messages: CLEARCHAT is sent to the
// whole room, so bans and timeouts are visible from outside too, and CLEARMSG
// carries single-message deletions.
//
// What it cannot tell you: who issued a moderation action or why. CLEARCHAT
// carries neither, and Twitch exposes no moderation history to third parties, so
// those stay null — a platform limit, not a gap in the parsing.
export const TWITCH_IRC_URL = "wss://irc-ws.chat.twitch.tv:443";
const KEEPALIVE_MS = 4 * 60 * 1000;
const INITIAL_RECONNECT_DELAY = 5000;
const MAX_RECONNECT_DELAY = 300000;

// Structural subset of the WebSocket, so tests drive the lifecycle with a fake.
export interface IrcSocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((error: unknown) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export interface ParsedIrcLine {
  tags: Record<string, string>;
  // The nick from the `:nick!user@host` prefix, when there is one.
  nick: string | null;
  command: string;
  params: string[];
  trailing: string | null;
}

// IRCv3 tag values escape a handful of characters, and only the value side needs
// decoding — a message body may legitimately contain "\s".
function unescapeTagValue(value: string): string {
  return value.replace(/\\([sn:r\\])/g, (_, char: string) => {
    if (char === "s") return " ";
    if (char === "n") return "\n";
    if (char === "r") return "\r";
    if (char === ":") return ";";
    return "\\";
  });
}

export function parseIrcLine(line: string): ParsedIrcLine | null {
  let rest = line.replace(/\r?\n$/, "");
  const tags: Record<string, string> = {};

  if (rest.startsWith("@")) {
    const end = rest.indexOf(" ");
    if (end === -1) return null;
    for (const pair of rest.slice(1, end).split(";")) {
      if (pair === "") continue;
      const equals = pair.indexOf("=");
      if (equals === -1) tags[pair] = "";
      else tags[pair.slice(0, equals)] = unescapeTagValue(pair.slice(equals + 1));
    }
    rest = rest.slice(end + 1).trimStart();
  }

  // The prefix names the sender of a PRIVMSG (`:login!login@login.tmi.twitch.tv`)
  // — the only place a chat line carries the sender's login, since the tags have
  // just `display-name`, which can be localized or differently cased.
  let nick: string | null = null;
  if (rest.startsWith(":")) {
    const end = rest.indexOf(" ");
    if (end === -1) return null;
    const bang = rest.indexOf("!");
    if (bang !== -1 && bang < end) nick = rest.slice(1, bang).toLowerCase();
    rest = rest.slice(end + 1).trimStart();
  }

  const trailingIndex = rest.indexOf(" :");
  const trailing = trailingIndex === -1 ? null : rest.slice(trailingIndex + 2);
  const head = trailingIndex === -1 ? rest : rest.slice(0, trailingIndex);
  const parts = head.split(" ").filter((part) => part !== "");
  const command = parts.shift();
  if (!command) return null;

  return { tags, nick, command: command.toUpperCase(), params: parts, trailing };
}

function channelFrom(params: string[]): string | null {
  const raw = params[0];
  if (!raw || !raw.startsWith("#")) return null;
  return raw.slice(1).toLowerCase();
}

function sentAtFromTags(tags: Record<string, string>): string | null {
  const ms = Number.parseInt(tags["tmi-sent-ts"] ?? "", 10);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// `badges=moderator/1,subscriber/12` — the set id is the part that means
// "moderator" regardless of tier, which is what the log keeps.
function badgesFromTags(tags: Record<string, string>): string[] {
  const raw = tags["badges"];
  if (!raw) return [];
  return raw
    .split(",")
    .map((badge) => badge.split("/")[0] ?? "")
    .filter((badge) => badge !== "");
}

// A line without Twitch's own message id still has to store exactly once, so the
// fallback is a hash of the line rather than a timestamp: a reconnect replaying
// it produces the same row key.
function fallbackId(line: string): string {
  return createHash("sha256").update(line).digest("hex").slice(0, 32);
}

// Ban and timeout lengths arrive in seconds over IRC, where the log stores
// minutes — the conversion Helix would need, taken from the other interface.
function timeoutFromTags(tags: Record<string, string>): {
  action: "ban" | "timeout";
  durationMinutes: number | null;
  expiresAt: string | null;
} {
  const seconds = Number.parseInt(tags["ban-duration"] ?? "", 10);
  if (!Number.isFinite(seconds)) {
    return { action: "ban", durationMinutes: null, expiresAt: null };
  }

  const createdAt = sentAtFromTags(tags);
  return {
    action: "timeout",
    durationMinutes: Math.max(1, Math.round(seconds / 60)),
    expiresAt: createdAt
      ? new Date(Date.parse(createdAt) + seconds * 1000).toISOString()
      : null,
  };
}

export type IrcOutcome =
  | "message"
  | "ban"
  | "timeout"
  | "message_delete"
  | "chat_clear"
  | "pong"
  | "ignored";

export interface IrcLineResult {
  outcome: IrcOutcome;
  // What to send back, when the line asks for something (a server PING).
  reply?: string;
}

// Parses one line, stores whatever it carries, and says which was which. Split
// from the socket so every mapping can be tested against real lines.
export function handleIrcLine(line: string): IrcLineResult {
  const parsed = parseIrcLine(line);
  if (!parsed) return { outcome: "ignored" };

  if (parsed.command === "PING") {
    return { outcome: "pong", reply: `PONG :${parsed.trailing ?? "tmi.twitch.tv"}` };
  }

  const channel = channelFrom(parsed.params);
  if (!channel) return { outcome: "ignored" };

  if (parsed.command === "PRIVMSG") {
    saveChatMessage({
      platform: "twitch",
      broadcasterLogin: channel,
      messageId: parsed.tags["id"] ?? fallbackId(line),
      // tmi-sent-ts is when the message was actually sent, which EventSub does
      // not provide — the log's offsets are exact rather than delivery-time.
      sentAt: sentAtFromTags(parsed.tags) ?? new Date().toISOString(),
      content: parsed.trailing ?? "",
      senderUserId: parsed.tags["user-id"] ?? null,
      senderLogin: parsed.nick,
      senderDisplay: parsed.tags["display-name"] || null,
      senderColor: parsed.tags["color"] || null,
      badges: badgesFromTags(parsed.tags),
      replyToMessageId: parsed.tags["reply-parent-msg-id"] ?? null,
    });

    return { outcome: "message" };
  }

  if (parsed.command === "CLEARCHAT") {
    const sentAt = sentAtFromTags(parsed.tags) ?? new Date().toISOString();
    const target = parsed.trailing?.toLowerCase() ?? null;
    const stamp = parsed.tags["tmi-sent-ts"] ?? sentAt;

    // No target means the whole room was cleared.
    if (!target) {
      saveModerationEvent({
        platform: "twitch",
        eventId: `clear:${channel}:${stamp}`,
        broadcasterLogin: channel,
        createdAt: sentAt,
        action: "chat_clear",
      });
      return { outcome: "chat_clear" };
    }

    const details = timeoutFromTags(parsed.tags);
    saveModerationEvent({
      platform: "twitch",
      eventId: `ban:${channel}:${target}:${stamp}`,
      broadcasterLogin: channel,
      createdAt: sentAt,
      action: details.action,
      targetUserId: parsed.tags["target-user-id"] ?? null,
      targetLogin: target,
      actorLogin: null,
      reason: null,
      durationMinutes: details.durationMinutes,
      expiresAt: details.expiresAt,
    });

    return { outcome: details.action };
  }

  if (parsed.command === "CLEARMSG") {
    const targetMessageId = parsed.tags["target-msg-id"] ?? fallbackId(line);

    saveModerationEvent({
      platform: "twitch",
      eventId: `delete:${targetMessageId}`,
      broadcasterLogin: channel,
      createdAt: sentAtFromTags(parsed.tags) ?? new Date().toISOString(),
      action: "message_delete",
      targetLogin: (parsed.tags["login"] ?? "").toLowerCase() || null,
      targetMessageId: parsed.tags["target-msg-id"] ?? null,
      reason: null,
      durationMinutes: null,
      expiresAt: null,
    });

    return { outcome: "message_delete" };
  }

  return { outcome: "ignored" };
}

let socket: IrcSocketLike | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = INITIAL_RECONNECT_DELAY;
let stopped = false;
let channels: string[] = [];
let nick = "";

export interface TwitchChatIrcDeps {
  createSocket?: (url: string) => IrcSocketLike;
  // Channels to join. Defaults to the Twitch entries in CHAT_LOG_CHANNELS.
  listChannels?: () => string[];
  nick?: string;
  reconnectDelayMs?: number;
}

function clearTimers(): void {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function dropConnection(): void {
  clearTimers();

  const current = socket;
  socket = null;
  if (!current) return;

  // Detach first: the socket's own onclose would otherwise schedule a second
  // reconnect on top of the one the caller is about to decide on.
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

  logger.info(`[Chat] Twitch IRC reconnecting in ${reconnectDelay / 1000}s`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);

  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

function connect(deps: TwitchChatIrcDeps = {}): void {
  const createSocket =
    deps.createSocket ?? ((url: string) => new WebSocket(url) as unknown as IrcSocketLike);

  let current: IrcSocketLike;
  try {
    current = createSocket(TWITCH_IRC_URL);
  } catch (error) {
    logger.error("[Chat] Twitch IRC connection failed:", error);
    scheduleReconnect();
    return;
  }

  socket = current;

  current.onopen = () => {
    if (socket !== current) return;
    reconnectDelay = deps.reconnectDelayMs ?? INITIAL_RECONNECT_DELAY;

    // Anonymous read: any password is accepted for a justinfan nick, and no
    // account is involved. The capabilities are what make badges, colours and
    // the moderation commands (CLEARCHAT/CLEARMSG) arrive at all.
    current.send("PASS SCHMOOPIIE");
    current.send(`NICK ${nick}`);
    current.send("CAP REQ :twitch.tv/tags twitch.tv/commands");

    for (const channel of channels) current.send(`JOIN #${channel}`);
    logger.info(
      `[Chat] Twitch IRC joined ${channels.length} channel(s): ${channels.map((c) => `#${c}`).join(", ")}`,
    );

    keepaliveTimer = setInterval(() => {
      if (socket === current) current.send("PING :tmi.twitch.tv");
    }, KEEPALIVE_MS);
    keepaliveTimer.unref?.();
  };

  current.onmessage = (event) => {
    if (socket !== current) return;

    // The server batches several lines into one frame, so every line is handled.
    for (const line of String(event.data).split(/\r?\n/)) {
      if (line.trim() === "") continue;
      const result = handleIrcLine(line);
      if (result.reply) current.send(result.reply);
    }
  };

  current.onerror = (error) => {
    logger.error("[Chat] Twitch IRC socket error:", error);
  };

  current.onclose = () => {
    if (socket !== current) return;
    dropConnection();
    scheduleReconnect();
  };
}

// Connects and joins every Twitch channel the log is configured for. Returns the
// channels it asked for, so startup can log a config mistake instead of a silent
// empty log.
export function startTwitchChatIrc(deps: TwitchChatIrcDeps = {}): string[] {
  const list =
    deps.listChannels ??
    (() =>
      chatLogTargets()
        .filter((target) => target.platform === "twitch")
        .map((target) => target.login));

  channels = list();
  if (channels.length === 0) {
    logger.info("[Chat] No Twitch channels configured; not connecting to IRC");
    return [];
  }

  // justinfanNNNNN is the documented anonymous nick; the digits only have to look
  // like a user number, and no account ever exists for it.
  nick = deps.nick ?? `justinfan${10_000 + Math.floor(Math.random() * 80_000)}`;
  stopped = false;
  reconnectDelay = deps.reconnectDelayMs ?? INITIAL_RECONNECT_DELAY;

  connect(deps);
  return channels;
}

export function stopTwitchChatIrc(): void {
  stopped = true;
  if (socket) logger.info("[Chat] Closing Twitch IRC connection...");
  dropConnection();
}

