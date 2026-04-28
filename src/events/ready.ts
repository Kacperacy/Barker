import { Client, Events } from "discord.js";
import { startTwitchMonitor } from "../services/twitch";
import { logger } from "../utils/logger";

export default (client: Client) => {
  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`✅ Ready! Logged in as ${readyClient.user.tag}`);

    startTwitchMonitor(client);
  });
};
