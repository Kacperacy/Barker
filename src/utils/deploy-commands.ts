import { REST, Routes } from "discord.js";
import type { Command } from "../types";
import { env } from "../config";
import { logger } from "../utils/logger";

export async function deployCommands(commands: Command[]) {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
  const commandData = commands.map((c) => c.data.toJSON());

  try {
    logger.info("Registering application (/) commands...");
    await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), {
      body: commandData,
    });
    logger.info(
      `Successfully reloaded ${commandData.length} application (/) commands.`,
    );
  } catch (e) {
    logger.error(e);
  }
}
