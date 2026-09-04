import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { env } from "../config";

const dbDir = env.DB_PATH;
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(`${dbDir}/bot.sqlite`, { create: true });

// The bot and the recorder are separate containers sharing this one file over
// a bind mount. The rollback journal serializes them into reader-blocks-writer
// stalls; WAL lets the recorder keep writing part progress while the bot reads.
// busy_timeout turns the remaining brief write contention into a short wait
// instead of an immediate SQLITE_BUSY throw.
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");

// Off by default in SQLite, so vod_archive_parts' ON DELETE CASCADE would
// otherwise be inert and leave orphaned part rows behind.
db.exec("PRAGMA foreign_keys = ON");

export const closeDatabase = () => {
  db.close();
};
