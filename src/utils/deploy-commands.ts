import { REST, Routes } from "discord.js";
import { env } from "../config";
import { logger } from "./logger";
import type { Command } from "../types";

export async function deployCommands(commandsMap: Map<string, Command>) {
  const commands = Array.from(commandsMap.values()).map((cmd) =>
    cmd.data.toJSON(),
  );
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

  try {
    logger.info(
      `Started refreshing ${commands.length} application (/) commands.`,
    );

    await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), {
      body: commands,
    });

    logger.info(
      `Successfully reloaded ${commands.length} application (/) commands.`,
    );
  } catch (error) {
    logger.error("Failed to deploy commands:", error);
  }
}
