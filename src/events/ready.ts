import { Client, Events } from "discord.js";
import { startTwitchMonitor } from "../services/twitch";

export default (client: Client) => {
  client.once(Events.ClientReady, (readyClient) => {
    console.log(`✅ Ready! Logged in as ${readyClient.user.tag}`);

    startTwitchMonitor(client);
  });
};
