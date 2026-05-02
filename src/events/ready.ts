import { Client, Events } from "discord.js";
import { logger } from "../utils/logger";
import { startEventSub } from "../twitch/eventsub";
import { setupTwitchHandlers } from "../twitch/handlers";
import { startCategoryPolling } from "../twitch/categoryPolling";

export default (client: Client) => {
  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Ready! Logged in as ${readyClient.user.tag}`);

    setupTwitchHandlers(client);

    startEventSub();

    startCategoryPolling(client);
  });
};
