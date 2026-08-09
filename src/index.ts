import { Client, GatewayIntentBits } from "discord.js";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { env } from "./config";
import ready from "./events/ready";
import interactionCreate from "./events/interactionCreate";
import { runMigrations } from "./database/migrations";
import { logger } from "./utils/logger";
import { db } from "./database/connection";
import { closeEventSub } from "./twitch/eventsub";
import { deployCommands } from "./utils/deploy-commands";
import type { Command } from "./types";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function shutdown(signal: string, exitCode: number): Promise<never> {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  try {
    closeEventSub();

    if (client.isReady()) {
      logger.info("Destroying Discord client...");
      await client.destroy();
    }

    logger.info("Closing database connection...");
    db.close();

    logger.info("Shutdown complete. Exiting process.");
  } catch (error) {
    logger.error("Error occurred during graceful shutdown:", error);
  }

  process.exit(exitCode);
}

process.on("unhandledRejection", (reason, promise) => {
  logger.error("CRITICAL: Unhandled Rejection at:", promise, "reason:", reason);
  void shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (error) => {
  logger.error("CRITICAL: Uncaught Exception:", error);
  void shutdown("uncaughtException", 1);
});

process.on("SIGINT", () => shutdown("SIGINT", 0));
process.on("SIGTERM", () => shutdown("SIGTERM", 0));

runMigrations();

const commands = new Map<string, Command>();
const commandsPath = join(__dirname, "commands");
const commandFiles = readdirSync(commandsPath).filter(
  (file) => file.endsWith(".ts") || file.endsWith(".js"),
);

for (const file of commandFiles) {
  const filePath = join(commandsPath, file);
  const module = await import(filePath);
  if (module.command && module.command.data) {
    commands.set(module.command.data.name, module.command);
  }
}

await deployCommands(commands);

ready(client);
interactionCreate(client, commands);

client.login(env.DISCORD_TOKEN);
