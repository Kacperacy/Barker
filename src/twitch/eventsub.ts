import EventEmitter from "node:events";
import { logger } from "../utils/logger";
import { getValidUserToken } from "./auth";
import { subscribeToEvent, cleanupZombieSubscriptions } from "./api";
import { getAllUniqueStreamers } from "../database/repositories/subscriptions";

export const twitchEvents = new EventEmitter();

let ws: WebSocket | null = null;
let sessionId: string = "";

const INITIAL_RECONNECT_DELAY = 5000;
const MAX_RECONNECT_DELAY = 300000;
let currentReconnectDelay = INITIAL_RECONNECT_DELAY;

export async function subscribeToStreamer(login: string) {
  if (!sessionId) return;
  await subscribeToEvent(login, "stream.online", sessionId);
  await subscribeToEvent(login, "stream.offline", sessionId);
}

function handleReconnect() {
  logger.info(
    `WebSocket Closed. Attempting to reconnect in ${currentReconnectDelay / 1000} seconds...`,
  );
  sessionId = "";

  setTimeout(() => {
    startEventSub();
  }, currentReconnectDelay);

  currentReconnectDelay = Math.min(
    currentReconnectDelay * 2,
    MAX_RECONNECT_DELAY,
  );
}

export async function startEventSub() {
  try {
    await getValidUserToken();
    await cleanupZombieSubscriptions();

    ws = new WebSocket("wss://eventsub.wss.twitch.tv/ws");
    ws.onopen = () => logger.info("Connecting to Twitch EventSub WebSocket...");

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data.toString());
      const messageType = msg.metadata.message_type;

      if (messageType === "session_welcome") {
        sessionId = msg.payload.session.id;
        logger.info(`WebSocket Session established! ID: ${sessionId}`);

        currentReconnectDelay = INITIAL_RECONNECT_DELAY;

        const streamers = getAllUniqueStreamers();
        for (const login of streamers) {
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
        ws?.close();
      }
    };

    ws.onerror = (error) => {
      logger.error("WebSocket Error:", error);
    };

    ws.onclose = () => {
      handleReconnect();
    };
  } catch (error) {
    logger.error("Failed to start EventSub:", error);
    handleReconnect();
  }
}

export function closeEventSub() {
  if (ws) {
    logger.info("Closing Twitch EventSub connection...");
    ws.close();
    ws = null;
  }
}
