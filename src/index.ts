import { Client, GatewayIntentBits } from "discord.js";
import { readdirSync } from "fs";
import type { Command } from "./types";
import { deployCommands } from "./utils/deploy-commands";
import readyEvent from "./events/ready";
import interactionEvent from "./events/interactionCreate";
import { env } from "./config";
import { closeDatabase } from "./database/connection";
import { logger } from "./utils/logger";
import { runMigrations } from "./database/migrations";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const commands = new Map<string, Command>();
const commandsList: Command[] = [];

// Run database migrations
runMigrations();

// Commands
const commandFiles = readdirSync("./src/commands").filter((f) =>
  f.endsWith(".ts"),
);
for (const file of commandFiles) {
  const { command } = require(`./commands/${file}`);
  commands.set(command.data.name, command);
  commandsList.push(command);
}

// Events
readyEvent(client);
interactionEvent(client, commands);

// Command deployment and bot login
(async () => {
  await deployCommands(commandsList);
  client.login(env.DISCORD_TOKEN);
})();

// Graceful shutdown
const shutdown = () => {
  logger.info("🛑 Shutting down gracefully...");
  client.destroy();
  closeDatabase();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
