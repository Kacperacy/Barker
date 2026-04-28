import { REST, Routes } from "discord.js";
import type { Command } from "../types";
import { env } from "../config";

export async function deployCommands(commands: Command[]) {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
  const commandData = commands.map((c) => c.data.toJSON());

  try {
    console.log("Registering application (/) commands...");
    await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), {
      body: commandData,
    });
    console.log(
      `Successfully reloaded ${commandData.length} application (/) commands.`,
    );
  } catch (e) {
    console.error(e);
  }
}
