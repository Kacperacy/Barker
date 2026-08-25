import EventEmitter from "node:events";
import { logger } from "../utils/logger";
import { getValidUserToken } from "./auth";
import { subscribeToEvent, cleanupZombieSubscriptions } from "./api";
import { getAllUniqueStreamers } from "../database/repositories/subscriptions";

export const twitchEvents = new EventEmitter();

// Structural subset of the platform WebSocket used here, so tests can drive
// the connection lifecycle with a fake instead of a real socket.
export interface WebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((error: unknown) => void) | null;
  onclose: (() => void) | null;
  close(): void;
}

export interface EventSubDeps {
  beforeConnect?: () => Promise<void>;
  createWebSocket?: (url: string) => WebSocketLike;
  subscribe?: (
    login: string,
    eventType: string,
    sessionId: string,
  ) => Promise<void>;
  listStreamers?: () => string[];
  // Slack on top of the session's keepalive_timeout before the session is
  // declared dead, covering network jitter and event-loop lag.
  keepaliveGraceMs?: number;
  initialReconnectDelayMs?: number;
}

const EVENTSUB_URL = "wss://eventsub.wss.twitch.tv/ws";
const DEFAULT_KEEPALIVE_TIMEOUT_SECONDS = 10;
const KEEPALIVE_GRACE_MS = 5000;
const INITIAL_RECONNECT_DELAY = 5000;
const MAX_RECONNECT_DELAY = 300000;

type ResolvedDeps = Required<EventSubDeps>;

function resolveDeps(overrides: EventSubDeps): ResolvedDeps {
  return {
    beforeConnect:
      overrides.beforeConnect ??
      (async () => {
        await getValidUserToken();
        await cleanupZombieSubscriptions();
      }),
    createWebSocket:
      overrides.createWebSocket ??
      ((url) => new WebSocket(url) as unknown as WebSocketLike),
    subscribe: overrides.subscribe ?? subscribeToEvent,
    listStreamers:
      overrides.listStreamers ?? (() => getAllUniqueStreamers("twitch")),
    keepaliveGraceMs: overrides.keepaliveGraceMs ?? KEEPALIVE_GRACE_MS,
    initialReconnectDelayMs:
      overrides.initialReconnectDelayMs ?? INITIAL_RECONNECT_DELAY,
  };
}

let deps: ResolvedDeps = resolveDeps({});
let ws: WebSocketLike | null = null;
let sessionId: string = "";
let keepaliveTimeoutSeconds = DEFAULT_KEEPALIVE_TIMEOUT_SECONDS;
let keepaliveTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentReconnectDelay = INITIAL_RECONNECT_DELAY;
let stopped = false;

export async function subscribeToStreamer(login: string) {
  const session = sessionId;
  if (!session) {
    logger.warn(`No live EventSub session; skipping subscribe for ${login}`);
    return;
  }

  await deps.subscribe(login, "stream.online", session);
  // The session can die mid-flight; don't fire the second call at a
  // session we already know is gone.
  if (sessionId !== session) return;
  await deps.subscribe(login, "stream.offline", session);
}

// Twitch only guarantees a live session while keepalives keep arriving. A
// socket that dies without a close frame (network drop, idle NAT timeout)
// otherwise leaves a stale sessionId behind, and every later subscribe is
// rejected with "websocket transport session does not exist".
function armKeepaliveWatchdog() {
  if (keepaliveTimer) clearTimeout(keepaliveTimer);

  const socket = ws;
  const timeoutMs =
    keepaliveTimeoutSeconds * 1000 + deps.keepaliveGraceMs;

  keepaliveTimer = setTimeout(() => {
    if (socket !== ws) return;
    logger.error(
      `No EventSub keepalive within ${timeoutMs}ms. Treating session ${sessionId} as dead.`,
    );
    dropConnection();
    handleReconnect();
  }, timeoutMs);
}

// Detaches handlers before closing so the socket's own onclose can't queue a
// second reconnect on top of the one the caller is about to schedule.
function dropConnection() {
  if (keepaliveTimer) {
    clearTimeout(keepaliveTimer);
    keepaliveTimer = null;
  }

  sessionId = "";

  const socket = ws;
  ws = null;
  if (!socket) return;

  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
  socket.close();
}

function handleReconnect() {
  if (stopped || reconnectTimer) return;

  logger.info(
    `WebSocket Closed. Attempting to reconnect in ${currentReconnectDelay / 1000} seconds...`,
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, currentReconnectDelay);

  currentReconnectDelay = Math.min(
    currentReconnectDelay * 2,
    MAX_RECONNECT_DELAY,
  );
}

async function connect() {
  try {
    await deps.beforeConnect();
    if (stopped) return;

    const socket = deps.createWebSocket(EVENTSUB_URL);
    ws = socket;

    socket.onopen = () =>
      logger.info("Connecting to Twitch EventSub WebSocket...");

    socket.onmessage = async (event) => {
      if (socket !== ws) return;

      const msg = JSON.parse(String(event.data));
      const messageType = msg.metadata.message_type;

      // Any traffic proves the session is still alive.
      armKeepaliveWatchdog();

      if (messageType === "session_welcome") {
        sessionId = msg.payload.session.id;
        keepaliveTimeoutSeconds =
          msg.payload.session.keepalive_timeout_seconds ??
          DEFAULT_KEEPALIVE_TIMEOUT_SECONDS;
        armKeepaliveWatchdog();
        logger.info(`WebSocket Session established! ID: ${sessionId}`);

        currentReconnectDelay = deps.initialReconnectDelayMs;

        for (const login of deps.listStreamers()) {
          if (socket !== ws) return;
          await subscribeToStreamer(login);
        }
      }

      if (messageType === "notification") {
        const eventType = msg.metadata.subscription_type;
        const eventData = msg.payload.event;

        if (eventType === "stream.online") {
          twitchEvents.emit("streamOnline", eventData);
        } else if (eventType === "stream.offline") {
          twitchEvents.emit("streamOffline", eventData);
        }
      }

      if (messageType === "session_reconnect") {
        logger.info("Twitch requested WebSocket reconnect. Adjusting...");
        dropConnection();
        handleReconnect();
      }
    };

    socket.onerror = (error) => {
      logger.error("WebSocket Error:", error);
    };

    socket.onclose = () => {
      if (socket !== ws) return;
      dropConnection();
      handleReconnect();
    };
  } catch (error) {
    logger.error("Failed to start EventSub:", error);
    handleReconnect();
  }
}

export async function startEventSub(overrides: EventSubDeps = {}) {
  deps = resolveDeps(overrides);
  stopped = false;
  currentReconnectDelay = deps.initialReconnectDelayMs;
  await connect();
}

export function closeEventSub() {
  stopped = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) logger.info("Closing Twitch EventSub connection...");
  dropConnection();
}
