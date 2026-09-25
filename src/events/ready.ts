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
import { startKickChatSocket } from "../kick/chatSocket";
import { startStreamHistoryPolling } from "../streams/polling";
import { startRecordingSync } from "../recordings/sync";
import { startChatRetention } from "../chat/retention";
import { logChatLoggingStatus } from "../chat/diagnostics";
import { isChatLoggingEnabled } from "../chat/ingest";
import { startTwitchChatIrc } from "../twitch/chatIrc";

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

    // Chat logging: report what is configured, then connect. Twitch is read over
    // anonymous IRC (no account, no scopes), Kick is subscribed to with the app
    // token — neither needs anyone to authorize as the channel's owner. Kick's
    // chat socket adds the deletions, unbans and clears its webhooks omit.
    logChatLoggingStatus();
    startTwitchChatIrc();
    startKickEventSubscriptionRefresh();
    if (isChatLoggingEnabled()) void startKickChatSocket();
    startStreamHistoryPolling();
    startRecordingSync();
    startChatRetention();
  });
};
