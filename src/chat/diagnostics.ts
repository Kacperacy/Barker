import { logger } from "../utils/logger";
import { getValidKickUserToken } from "../kick/auth";
import { TWITCH_CHAT_SCOPES, validateTwitchToken } from "../twitch/api";
import { chatLogTargets, isChatLoggingEnabled } from "./ingest";

// A token that is missing `user:read:chat` (Twitch) or a Kick user token
// subscribes to nothing and then simply never delivers: the log stays empty and
// nothing says why. This reports the actual state at startup instead.
export async function logChatLoggingStatus(): Promise<void> {
  if (!isChatLoggingEnabled()) {
    logger.info("[Chat] chat logging is off (CHAT_LOG_ENABLED=false)");
    return;
  }

  const targets = chatLogTargets();
  logger.info(
    `[Chat] logging ${targets.length} channel(s): ${
      targets.map((target) => `${target.platform}:${target.login}`).join(", ") ||
      "(none configured — set CHAT_LOG_CHANNELS)"
    }`,
  );

  try {
    const twitch = await validateTwitchToken();
    if (!twitch) {
      logger.warn(
        "[Chat] could not validate the Twitch token; chat topics may not be subscribed",
      );
    } else {
      const missing = TWITCH_CHAT_SCOPES.filter(
        (scope) => !twitch.scopes.includes(scope),
      );
      if (missing.length > 0) {
        logger.warn(
          `[Chat] Twitch token (${twitch.login ?? "unknown"}) is missing ${missing.join(", ")} — re-authorize: bun run src/tools/authorize.ts twitch`,
        );
      } else {
        logger.info(`[Chat] Twitch token ok (${twitch.login ?? "unknown"})`);
      }
    }
  } catch (error) {
    logger.error("[Chat] Twitch token check threw:", error);
  }

  try {
    const kick = await getValidKickUserToken();
    if (!kick) {
      logger.warn(
        "[Chat] no Kick user token, so no Kick chat or bans will arrive — authorize: bun run src/tools/authorize.ts kick",
      );
    } else {
      logger.info("[Chat] Kick user token present");
    }
  } catch (error) {
    logger.error("[Chat] Kick token check threw:", error);
  }
}
