import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { env } from "../config";

const dbDir = env.DB_PATH;
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(`${dbDir}/bot.sqlite`, { create: true });

export const closeDatabase = () => {
  db.close();
};
