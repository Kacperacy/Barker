import { Client, Events } from "discord.js";
import { logger } from "../utils/logger";
import { setupTwitchHandlers } from "../twitch/handlers";
import { startEventSub } from "../twitch/eventsub";

export default (client: Client) => {
  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`✅ Ready! Logged in as ${readyClient.user.tag}`);

    setupTwitchHandlers(client);

    startEventSub();
  });
};
