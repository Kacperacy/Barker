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
    const commandNames = commands.map((c) => c.name).join(", ");
    logger.info(
      `Found ${commands.length} commands to deploy: [${commandNames}]`,
    );

    const guilds = (await rest.get(Routes.userGuilds())) as any[];

    for (const guild of guilds) {
      try {
        await rest.put(
          Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guild.id),
          { body: [] },
        );
        logger.info(`Cleared ghost guild commands for guild: ${guild.id}`);
      } catch (err) {}
    }

    await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), {
      body: commands,
    });

    logger.info(
      `Successfully reloaded ${commands.length} global (/) commands.`,
    );
  } catch (error) {
    logger.error("Failed to deploy commands:", error);
  }
}
