import type { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { env } from "../config";
import { db as defaultDb } from "../database/connection";
import type { Platform } from "../types";

// Site accounts: who logged in with which platform, their sessions, their role
// and whether a moderator muted them. Nothing here holds a platform token.

export type Role = "user" | "mod" | "admin";

export interface UserRow {
  id: number;
  platform: Platform;
  platform_user_id: string;
  login: string;
  display: string | null;
  avatar: string | null;
  created_at: string;
  last_login_at: string;
}

export interface Mute {
  until: string | null;
  reason: string | null;
}

export const SESSION_COOKIE = "klaun_session";
export const SESSION_DAYS = 30;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function upsertUser(
  profile: {
    platform: Platform;
    platformUserId: string;
    login: string;
    display: string | null;
    avatar: string | null;
  },
  db: Database = defaultDb,
  now: string = new Date().toISOString(),
): UserRow {
  db.query(
    `INSERT INTO users (platform, platform_user_id, login, display, avatar, created_at, last_login_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
     ON CONFLICT (platform, platform_user_id) DO UPDATE SET
       login = excluded.login,
       display = excluded.display,
       avatar = excluded.avatar,
       last_login_at = excluded.last_login_at`,
  ).run(
    profile.platform,
    profile.platformUserId,
    profile.login.toLowerCase(),
    profile.display,
    profile.avatar,
    now,
  );
  return db
    .query("SELECT * FROM users WHERE platform = ?1 AND platform_user_id = ?2")
    .get(profile.platform, profile.platformUserId) as UserRow;
}

export function getUser(id: number, db: Database = defaultDb): UserRow | null {
  return (db.query("SELECT * FROM users WHERE id = ?1").get(id) as UserRow | null) ?? null;
}

// Returns the raw token for the cookie; only its hash is stored.
export function createSession(
  userId: number,
  db: Database = defaultDb,
  now: Date = new Date(),
): string {
  const token = randomToken();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  db.query(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
  ).run(sha256(token), userId, now.toISOString(), expires.toISOString());
  return token;
}

export function userForSession(
  token: string | null,
  db: Database = defaultDb,
  now: string = new Date().toISOString(),
): UserRow | null {
  if (!token) return null;
  const row = db
    .query(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?1 AND s.expires_at > ?2`,
    )
    .get(sha256(token), now) as UserRow | null;
  return row ?? null;
}

export function deleteSession(token: string | null, db: Database = defaultDb): void {
  if (!token) return;
  db.query("DELETE FROM sessions WHERE token_hash = ?1").run(sha256(token));
}

// "<platform>:<login>" entries from ADMIN_ACCOUNTS.
function adminAccounts(): Set<string> {
  return new Set(
    env.ADMIN_ACCOUNTS.split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.includes(":")),
  );
}

export function roleOf(user: UserRow, db: Database = defaultDb): Role {
  if (adminAccounts().has(`${user.platform}:${user.login.toLowerCase()}`)) return "admin";
  const row = db.query("SELECT role FROM user_roles WHERE user_id = ?1").get(user.id) as
    | { role: string }
    | null;
  return row?.role === "mod" ? "mod" : "user";
}

export function isModerator(role: Role): boolean {
  return role === "mod" || role === "admin";
}

export function setModerator(
  userId: number,
  granted: boolean,
  byUserId: number,
  db: Database = defaultDb,
  now: string = new Date().toISOString(),
): void {
  if (granted) {
    db.query(
      `INSERT INTO user_roles (user_id, role, granted_by, granted_at) VALUES (?1, 'mod', ?2, ?3)
       ON CONFLICT (user_id) DO UPDATE SET role = 'mod', granted_by = ?2, granted_at = ?3`,
    ).run(userId, byUserId, now);
  } else {
    db.query("DELETE FROM user_roles WHERE user_id = ?1").run(userId);
  }
}

// The mute in force, if any: not lifted and not expired.
export function activeMute(
  userId: number,
  db: Database = defaultDb,
  now: string = new Date().toISOString(),
): Mute | null {
  const row = db
    .query(
      `SELECT until, reason FROM user_mutes
        WHERE user_id = ?1 AND lifted_at IS NULL AND (until IS NULL OR until > ?2)
        ORDER BY until IS NULL DESC, until DESC LIMIT 1`,
    )
    .get(userId, now) as Mute | null;
  return row ?? null;
}

export function muteUser(
  userId: number,
  minutes: number | null,
  reason: string | null,
  byUserId: number,
  db: Database = defaultDb,
  now: Date = new Date(),
): Mute {
  const until = minutes === null ? null : new Date(now.getTime() + minutes * 60_000).toISOString();
  db.query(
    `INSERT INTO user_mutes (user_id, until, reason, by_user_id, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).run(userId, until, reason, byUserId, now.toISOString());
  return { until, reason };
}

export function unmuteUser(
  userId: number,
  db: Database = defaultDb,
  now: string = new Date().toISOString(),
): number {
  return db
    .query("UPDATE user_mutes SET lifted_at = ?2 WHERE user_id = ?1 AND lifted_at IS NULL")
    .run(userId, now).changes;
}

// Whether the platform's own chat currently bans this account in the channel:
// a permanent ban not followed by an unban, or a timeout that has not expired.
// Read from the moderation log Barker already keeps.
export function chatBanned(
  user: UserRow,
  channel: { platform: Platform; login: string },
  db: Database = defaultDb,
  now: string = new Date().toISOString(),
): boolean {
  if (user.platform !== channel.platform) return false;
  const latest = db
    .query(
      `SELECT action, expires_at FROM moderation_events
        WHERE platform = ?1 AND broadcaster_login = ?2
          AND action IN ('ban', 'timeout', 'unban')
          AND (target_login = ?3 OR target_user_id = ?4)
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(channel.platform, channel.login, user.login, user.platform_user_id) as
    | { action: string; expires_at: string | null }
    | null;
  if (!latest) return false;
  if (latest.action === "ban") return true;
  if (latest.action === "timeout") return latest.expires_at === null || latest.expires_at > now;
  return false;
}

export function logModAction(
  entry: {
    actorUserId: number;
    action: string;
    targetType: "highlight" | "user" | "report";
    targetId: number | null;
    details?: Record<string, unknown>;
  },
  db: Database = defaultDb,
  now: string = new Date().toISOString(),
): void {
  db.query(
    `INSERT INTO mod_actions (actor_user_id, action, target_type, target_id, details, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).run(
    entry.actorUserId,
    entry.action,
    entry.targetType,
    entry.targetId,
    entry.details ? JSON.stringify(entry.details) : null,
    now,
  );
}
