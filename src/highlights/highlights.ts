import type { Database } from "bun:sqlite";
import { env } from "../config";
import { db as defaultDb } from "../database/connection";
import type { Platform } from "../types";
import {
  activeMute,
  chatBanned,
  isModerator,
  logModAction,
  roleOf,
  type Role,
  type UserRow,
} from "../auth/accounts";

// Viewer-marked highlights: a logged-in viewer marks "this was a moment" while
// watching (live or a recording), and marks by different people close together
// are shown as one moment with a count.
//
// Marks are public as soon as they are made, so the rules here are the first
// line of moderation: rate limits, a note filter, chat bans carried over, mod
// mutes, and reports that hide a mark on their own at REPORTS_TO_HIDE.

export const HIGHLIGHT_KINDS = ["hype", "funny", "drama", "music", "other"] as const;
export type HighlightKind = (typeof HIGHLIGHT_KINDS)[number];

export const NOTE_MAX = 80;
// Per user, moderators exempt: one mark per interval, a cap per window.
export const MIN_INTERVAL_S = 30;
export const MAX_PER_WINDOW = 30;
const WINDOW_MS = 12 * 3600 * 1000;
// Marks this close to the first mark of a moment belong to it.
export const MOMENT_SPAN_S = 90;
export const REPORTS_TO_HIDE = 3;
// A mark made on a recording may reach this far back.
const VOD_MARK_MAX_AGE_MS = 90 * 86_400_000;
const LIVE_BACK_OPTIONS = [0, 30, 60];

export class HighlightError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------------ notes

const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(pl|com|net|org|gg|tv|io|me|ly|xyz|ru|eu|co)\b)/i;

function bannedWords(): string[] {
  return env.HIGHLIGHT_BANNED_WORDS.split(",")
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 0);
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l");
}

// A note as stored: trimmed, single-spaced, without control characters. Throws
// with a reason the viewer can act on when it cannot be accepted.
export function cleanNote(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw new HighlightError("Notatka musi być tekstem.", 400);
  const text = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return null;
  if (text.length > NOTE_MAX) throw new HighlightError(`Notatka może mieć najwyżej ${NOTE_MAX} znaków.`, 400);
  if (LINK.test(text)) throw new HighlightError("Notatka nie może zawierać linków.", 400);
  const folded = fold(text);
  if (bannedWords().some((word) => folded.includes(fold(word)))) {
    throw new HighlightError("Notatka zawiera niedozwolone słowo.", 400);
  }
  return text;
}

// ------------------------------------------------------------------ creating

export interface NewHighlight {
  channel: { platform: Platform; login: string };
  kind: HighlightKind;
  note: string | null;
  // Live marks: seconds before "now" the moment was (0/30/60). Recording marks
  // pass the instant itself.
  back?: number;
  at?: string;
  streamId?: string | null;
}

export function assertMayMark(
  user: UserRow,
  channel: { platform: Platform; login: string },
  db: Database = defaultDb,
  now: Date = new Date(),
): Role {
  const role = roleOf(user, db);
  const mute = activeMute(user.id, db, now.toISOString());
  if (mute) {
    const until = mute.until ? ` do ${mute.until}` : "";
    throw new HighlightError(`Moderator zablokował Ci oznaczanie momentów${until}.`, 403);
  }
  if (!isModerator(role) && chatBanned(user, channel, db, now.toISOString())) {
    throw new HighlightError("Masz bana lub timeout na czacie kanału.", 403);
  }
  if (isModerator(role)) return role;

  const last = db
    .query("SELECT created_at FROM highlights WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1")
    .get(user.id) as { created_at: string } | null;
  if (last && now.getTime() - Date.parse(last.created_at) < MIN_INTERVAL_S * 1000) {
    throw new HighlightError(`Moment można oznaczyć raz na ${MIN_INTERVAL_S} s.`, 429);
  }
  const recent = (
    db
      .query("SELECT COUNT(*) AS n FROM highlights WHERE user_id = ?1 AND created_at > ?2")
      .get(user.id, new Date(now.getTime() - WINDOW_MS).toISOString()) as { n: number }
  ).n;
  if (recent >= MAX_PER_WINDOW) {
    throw new HighlightError(`Limit ${MAX_PER_WINDOW} momentów na 12 godzin.`, 429);
  }
  return role;
}

export function createHighlight(
  user: UserRow,
  input: NewHighlight,
  live: { streamId: string } | null,
  db: Database = defaultDb,
  now: Date = new Date(),
): number {
  assertMayMark(user, input.channel, db, now);

  let at: Date;
  let source: "live" | "vod";
  if (input.at !== undefined) {
    const parsed = Date.parse(input.at);
    if (Number.isNaN(parsed)) throw new HighlightError("Nieprawidłowy czas momentu.", 400);
    if (parsed > now.getTime() - 60_000) {
      throw new HighlightError("Na nagraniu można oznaczyć tylko to, co już minęło.", 400);
    }
    if (parsed < now.getTime() - VOD_MARK_MAX_AGE_MS) {
      throw new HighlightError("To nagranie jest za stare na nowe momenty.", 400);
    }
    at = new Date(parsed);
    source = "vod";
  } else {
    if (!live) throw new HighlightError("Kanał teraz nie nadaje.", 409);
    const back = input.back ?? 0;
    if (!LIVE_BACK_OPTIONS.includes(back)) throw new HighlightError("Nieprawidłowe cofnięcie.", 400);
    at = new Date(now.getTime() - (env.HIGHLIGHT_LIVE_DELAY_S + back) * 1000);
    source = "live";
  }

  const result = db
    .query(
      `INSERT INTO highlights
         (user_id, channel_platform, channel_login, stream_id, at, source, kind, note, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .run(
      user.id,
      input.channel.platform,
      input.channel.login.toLowerCase(),
      source === "live" ? (live?.streamId ?? null) : (input.streamId ?? null),
      at.toISOString(),
      source,
      input.kind,
      input.note,
      now.toISOString(),
    );
  return Number(result.lastInsertRowid);
}

// ------------------------------------------------------------------ reading

interface MarkRow {
  id: number;
  user_id: number;
  at: string;
  kind: HighlightKind;
  note: string | null;
  note_removed: number;
  source: string;
  login: string;
  display: string | null;
  platform: Platform;
}

export interface MomentMark {
  id: number;
  kind: HighlightKind;
  note: string | null;
  by: { display: string; platform: Platform };
  mine: boolean;
}

export interface Moment {
  // The median of its marks: one early or late click does not move it much.
  at: string;
  count: number;
  kind: HighlightKind;
  marks: MomentMark[];
}

// The public moments of a channel between two instants.
export function listMoments(
  channel: { platform: Platform; login: string },
  from: string,
  to: string,
  viewerId: number | null,
  db: Database = defaultDb,
): Moment[] {
  const rows = db
    .query(
      `SELECT h.id, h.user_id, h.at, h.kind, h.note, h.note_removed, h.source,
              u.login, u.display, u.platform
         FROM highlights h JOIN users u ON u.id = h.user_id
        WHERE h.channel_platform = ?1 AND h.channel_login = ?2
          AND h.at >= ?3 AND h.at <= ?4
          AND h.deleted = 0 AND h.hidden = 0
        ORDER BY h.at`,
    )
    .all(channel.platform, channel.login.toLowerCase(), from, to) as MarkRow[];

  const groups: MarkRow[][] = [];
  for (const row of rows) {
    const current = groups[groups.length - 1];
    if (current && Date.parse(row.at) - Date.parse(current[0]!.at) <= MOMENT_SPAN_S * 1000) {
      current.push(row);
    } else {
      groups.push([row]);
    }
  }

  return groups.map((group) => {
    const times = group.map((row) => Date.parse(row.at)).sort((a, b) => a - b);
    const median = times[Math.floor((times.length - 1) / 2)]!;
    const kinds = new Map<HighlightKind, number>();
    for (const row of group) kinds.set(row.kind, (kinds.get(row.kind) ?? 0) + 1);
    const kind = [...kinds.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    return {
      at: new Date(median).toISOString(),
      count: new Set(group.map((row) => row.user_id)).size,
      kind,
      marks: group.map((row) => ({
        id: row.id,
        kind: row.kind,
        note: row.note_removed ? null : row.note,
        by: { display: row.display ?? row.login, platform: row.platform },
        mine: viewerId !== null && row.user_id === viewerId,
      })),
    };
  });
}

// ------------------------------------------------------------------ viewer actions

export function deleteOwnHighlight(user: UserRow, id: number, db: Database = defaultDb): void {
  const changed = db
    .query("UPDATE highlights SET deleted = 1 WHERE id = ?1 AND user_id = ?2 AND deleted = 0")
    .run(id, user.id).changes;
  if (changed === 0) throw new HighlightError("Nie ma takiego Twojego momentu.", 404);
}

// One report per viewer per mark; at REPORTS_TO_HIDE open reports the mark is
// hidden until a moderator looks at it.
export function reportHighlight(
  user: UserRow,
  id: number,
  reason: string | null,
  db: Database = defaultDb,
  now: string = new Date().toISOString(),
): { hidden: boolean } {
  const mark = db.query("SELECT user_id FROM highlights WHERE id = ?1 AND deleted = 0").get(id) as
    | { user_id: number }
    | null;
  if (!mark) throw new HighlightError("Nie ma takiego momentu.", 404);
  if (mark.user_id === user.id) throw new HighlightError("Nie możesz zgłosić własnego momentu.", 400);

  const text = reason === null ? null : reason.replace(/\s+/g, " ").trim().slice(0, 200) || null;
  const inserted = db
    .query(
      `INSERT OR IGNORE INTO highlight_reports (highlight_id, user_id, reason, created_at)
       VALUES (?1, ?2, ?3, ?4)`,
    )
    .run(id, user.id, text, now).changes;
  if (inserted === 0) throw new HighlightError("Ten moment jest już przez Ciebie zgłoszony.", 409);

  const open = (
    db
      .query("SELECT COUNT(*) AS n FROM highlight_reports WHERE highlight_id = ?1 AND resolved_at IS NULL")
      .get(id) as { n: number }
  ).n;
  if (open >= REPORTS_TO_HIDE) {
    db.query(
      "UPDATE highlights SET hidden = 1, hidden_reason = 'zgłoszenia' WHERE id = ?1 AND hidden = 0",
    ).run(id);
    return { hidden: true };
  }
  return { hidden: false };
}

// ------------------------------------------------------------------ moderation

export type ModAction = "hide" | "restore" | "remove_note" | "delete";

export interface ModMarkRow {
  id: number;
  at: string;
  created_at: string;
  source: string;
  kind: HighlightKind;
  note: string | null;
  note_removed: number;
  hidden: number;
  hidden_reason: string | null;
  deleted: number;
  channel_platform: Platform;
  channel_login: string;
  user_id: number;
  login: string;
  display: string | null;
  platform: Platform;
  open_reports: number;
  report_reasons: string | null;
}

export function listForModeration(
  filter: { status: "reported" | "hidden" | "all"; userId?: number; limit?: number },
  db: Database = defaultDb,
): ModMarkRow[] {
  const conditions = ["h.deleted = 0"];
  const params: (string | number)[] = [];
  if (filter.status === "reported") conditions.push("open_reports > 0");
  if (filter.status === "hidden") conditions.push("h.hidden = 1");
  if (filter.userId !== undefined) {
    params.push(filter.userId);
    conditions.push(`h.user_id = ?${params.length}`);
  }
  params.push(Math.min(Math.max(1, filter.limit ?? 100), 500));
  return db
    .query(
      `SELECT * FROM (
         SELECT h.*, u.login, u.display, u.platform,
           (SELECT COUNT(*) FROM highlight_reports r
             WHERE r.highlight_id = h.id AND r.resolved_at IS NULL) AS open_reports,
           (SELECT GROUP_CONCAT(COALESCE(r.reason, '—'), ' | ') FROM highlight_reports r
             WHERE r.highlight_id = h.id AND r.resolved_at IS NULL) AS report_reasons
         FROM highlights h JOIN users u ON u.id = h.user_id
       ) h
       WHERE ${conditions.join(" AND ")}
       ORDER BY open_reports DESC, h.created_at DESC
       LIMIT ?${params.length}`,
    )
    .all(...params) as ModMarkRow[];
}

// A moderator's decision on one mark. Every decision resolves the mark's open
// reports and is written to the audit log.
export function moderateHighlight(
  moderator: UserRow,
  id: number,
  action: ModAction,
  reason: string | null,
  db: Database = defaultDb,
  now: string = new Date().toISOString(),
): void {
  if (!isModerator(roleOf(moderator, db))) throw new HighlightError("Brak uprawnień.", 403);
  const exists = db.query("SELECT id FROM highlights WHERE id = ?1").get(id);
  if (!exists) throw new HighlightError("Nie ma takiego momentu.", 404);

  const statements: Record<ModAction, string> = {
    hide: "UPDATE highlights SET hidden = 1, hidden_reason = ?2 WHERE id = ?1",
    restore: "UPDATE highlights SET hidden = 0, hidden_reason = NULL, deleted = 0 WHERE id = ?1",
    remove_note: "UPDATE highlights SET note_removed = 1 WHERE id = ?1",
    delete: "UPDATE highlights SET deleted = 1 WHERE id = ?1",
  };
  db.transaction(() => {
    if (action === "hide") db.query(statements.hide).run(id, reason ?? "moderator");
    else db.query(statements[action]).run(id);
    db.query(
      `UPDATE highlight_reports SET resolved_at = ?2, resolved_by = ?3
        WHERE highlight_id = ?1 AND resolved_at IS NULL`,
    ).run(id, now, moderator.id);
    logModAction(
      { actorUserId: moderator.id, action: `highlight.${action}`, targetType: "highlight", targetId: id, details: reason ? { reason } : undefined },
      db,
      now,
    );
  })();
}

// Hides everything a user marked (used with a mute for spam).
export function hideAllByUser(userId: number, reason: string, db: Database = defaultDb): number {
  return db
    .query("UPDATE highlights SET hidden = 1, hidden_reason = ?2 WHERE user_id = ?1 AND hidden = 0 AND deleted = 0")
    .run(userId, reason).changes;
}
