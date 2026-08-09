import type { Database } from "bun:sqlite";
import { db as defaultDb } from "../connection";
import { migrations } from "./list";

export function runMigrations(db: Database = defaultDb) {
  db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  ).run();

  const appliedVersions = new Set(
    (
      db.query("SELECT version FROM schema_migrations").all() as {
        version: number;
      }[]
    ).map((row) => row.version),
  );

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;

    const applyMigration = db.transaction(() => {
      migration.up(db);
      db.query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
      ).run(migration.version, new Date().toISOString());
    });

    applyMigration();
  }
}
