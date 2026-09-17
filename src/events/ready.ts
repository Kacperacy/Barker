import { Client, Events } from "discord.js";
import { logger } from "../utils/logger";
import { startEventSub } from "../twitch/eventsub";
import { setupTwitchHandlers } from "../twitch/handlers";
import { startCategoryPolling } from "../twitch/categoryPolling";
import { startKickStreamerPolling } from "../kick/streamerPolling";
import { startKickCategoryPolling } from "../kick/categoryPolling";
import { startRiotPolling } from "../riot/polling";
import { startDailySummaryTimer } from "../riot/summary";
import { startKickEventSubscriptionRefresh } from "../kick/events";
import { startChatRetention } from "../chat/retention";
import { logChatLoggingStatus } from "../chat/diagnostics";

export default (client: Client) => {
  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Ready! Logged in as ${readyClient.user.tag}`);

    setupTwitchHandlers(client);
    startEventSub();
    startCategoryPolling(client);
    startKickStreamerPolling(client);
    startKickCategoryPolling(client);
    startRiotPolling(client);
    startDailySummaryTimer(client);

    // Chat logging: report what is actually authorized before anything tries to
    // use it, then keep the Kick webhook subscriptions alive (Kick unsubscribes
    // an endpoint that fails for a day).
    void logChatLoggingStatus();
    startKickEventSubscriptionRefresh();
    startChatRetention();
  });
};
