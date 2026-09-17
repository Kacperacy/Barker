import { env } from "../config";
import { logger } from "../utils/logger";
import { chatLogTargets, isChatLoggingEnabled } from "./ingest";

// Nothing here needs an account: Twitch is read over anonymous IRC and Kick is
// subscribed to with the app's own token. The only thing that can be wrong at
// startup is the configuration, and saying so plainly is what stops "the log is
// empty" from being mistaken for "the channel is quiet".
export function logChatLoggingStatus(): void {
  if (!isChatLoggingEnabled()) {
    logger.info("[Chat] chat logging is off (CHAT_LOG_ENABLED=false)");
    return;
  }

  const targets = chatLogTargets();
  if (targets.length === 0) {
    logger.warn(
      "[Chat] CHAT_LOG_ENABLED is on but CHAT_LOG_CHANNELS is empty — nothing will be logged",
    );
    return;
  }

  const twitch = targets
    .filter((target) => target.platform === "twitch")
    .map((target) => `#${target.login}`);
  const kick = targets
    .filter((target) => target.platform === "kick")
    .map((target) => target.login);

  logger.info(
    `[Chat] logging ${targets.length} channel(s) — Twitch over anonymous IRC (${
      twitch.join(", ") || "none"
    }), Kick over webhooks (${kick.join(", ") || "none"})`,
  );

  if (kick.length > 0) {
    const base = env.PUBLIC_BASE_URL || `http://<host>:${env.API_PORT}`;
    logger.info(
      `[Chat] Kick delivers to ${base}/webhooks/kick — that URL has to be reachable over HTTPS, or Kick refuses the subscription`,
    );
  }
}
