import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandStringOption,
} from "discord.js";
import type { Platform } from "../types";

export async function requireGuildId(
  interaction: ChatInputCommandInteraction,
): Promise<string | null> {
  if (interaction.guildId) return interaction.guildId;

  await interaction.reply({
    content: "This command can only be used in a server.",
    ephemeral: true,
  });
  return null;
}

// Shared across every command that accepts a platform choice, so the option
// definition and its default-to-twitch behavior stay in one place.
export function addPlatformOption(
  opt: SlashCommandStringOption,
): SlashCommandStringOption {
  return opt
    .setName("platform")
    .setDescription("Streaming platform (defaults to Twitch)")
    .addChoices(
      { name: "Twitch", value: "twitch" },
      { name: "Kick", value: "kick" },
    )
    .setRequired(false);
}

export function getPlatformOption(
  interaction: ChatInputCommandInteraction | AutocompleteInteraction,
): Platform {
  return (
    (interaction.options.getString("platform") as Platform | null) ?? "twitch"
  );
}
