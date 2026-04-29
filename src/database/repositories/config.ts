import { db } from "../connection";

export const setConfig = (key: string, value: string) => {
  db.query("INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)").run(
    key,
    value,
  );
};

export const getConfig = (key: string): string | null => {
  const res = db.query("SELECT value FROM config WHERE key = ?1").get(key) as {
    value: string;
  } | null;
  return res ? res.value : null;
};
