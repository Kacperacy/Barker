import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  AutocompleteInteraction,
} from "discord.js";

export type Platform = "twitch" | "kick";

export interface Command {
  data: SlashCommandBuilder | any;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}
