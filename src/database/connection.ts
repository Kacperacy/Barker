import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";

const dbDir = "./db";
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(`${dbDir}/bot.sqlite`, { create: true });

export const closeDatabase = () => {
  db.close();
};
