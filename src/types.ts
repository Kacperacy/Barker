import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

export interface Command {
  data: SlashCommandBuilder | any;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}
