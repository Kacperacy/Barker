import type { Database } from "bun:sqlite";
import { env } from "../config";
import { getLiveBroadcast } from "../chat/live";
import type { Platform } from "../types";
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  activeMute,
  createSession,
  deleteSession,
  purgeExpiredSessions,
  getUser,
  isModerator,
  logModAction,
  muteUser,
  roleOf,
  setModerator,
  unmuteUser,
  upsertUser,
  userForSession,
  type UserRow,
} from "../auth/accounts";
import { beginLogin, finishLogin, takeState } from "../auth/oauth";
import {
  HIGHLIGHT_KINDS,
  HighlightError,
  cleanNote,
  createHighlight,
  deleteOwnHighlight,
  hideAllByUser,
  listForModeration,
  listMoments,
  moderateHighlight,
  reportHighlight,
  type HighlightKind,
  type ModAction,
} from "../highlights/highlights";

// Login, highlights and moderation. The site reaches these through its own
// /barker proxy, so the session cookie is first-party on the site's origin.
// Every state-changing request must come from one of SITE_ORIGINS (on top of
// the SameSite=Lax cookie), which is what stops another site from marking or
// moderating in a logged-in viewer's name.

export interface AccountDeps {
  db: Database;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function redirect(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store", ...headers } });
}

function sessionToken(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/barker; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

const CLEAR_COOKIE = `${SESSION_COOKIE}=; Path=/barker; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function sameSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = env.SITE_ORIGINS.split(",").map((entry) => entry.trim().replace(/\/$/, ""));
  return allowed.includes(origin.replace(/\/$/, ""));
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 10_000) throw new HighlightError("Za duże zapytanie.", 413);
  if (text.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  throw new HighlightError("Oczekiwano obiektu JSON.", 400);
}

function platformOf(value: unknown): Platform {
  if (value === "kick" || value === "twitch") return value;
  throw new HighlightError("Nieznana platforma.", 400);
}

function publicUser(user: UserRow, db: Database, now: string) {
  const mute = activeMute(user.id, db, now);
  return {
    id: user.id,
    platform: user.platform,
    login: user.login,
    display: user.display ?? user.login,
    avatar: user.avatar,
    role: roleOf(user, db),
    muted: mute ? { until: mute.until, reason: mute.reason } : null,
  };
}

// Returns null when the path is not one of these routes.
export async function handleAccountRequest(
  request: Request,
  url: URL,
  deps: AccountDeps,
): Promise<Response | null> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const path = url.pathname;
  const method = request.method;

  const login = /^\/auth\/(kick|twitch)\/(start|callback)$/.exec(path);
  const isAccountPath =
    login !== null ||
    path === "/auth/logout" ||
    path === "/api/me" ||
    path.startsWith("/api/highlights") ||
    path.startsWith("/api/mod/");
  if (!isAccountPath) return null;

  try {
    if (login) {
      const platform = login[1] as Platform;
      if (login[2] === "start") {
        return redirect(beginLogin(platform, url.searchParams.get("return"), db, now));
      }
      const state = takeState(platform, url.searchParams.get("state"), db, now);
      const code = url.searchParams.get("code");
      if (!state || !code) return redirect("/?login=error");
      const profile = await finishLogin(platform, code, state.verifier, deps.fetchImpl);
      if (!profile) return redirect(`${state.returnTo}${state.returnTo.includes("?") ? "&" : "?"}login=error`);
      const user = upsertUser(profile, db, now.toISOString());
      purgeExpiredSessions(db, now.toISOString());
      return redirect(state.returnTo, { "Set-Cookie": sessionCookie(createSession(user.id, db, now)) });
    }

    const token = sessionToken(request);
    const viewer = userForSession(token, db, now.toISOString());

    if (method !== "GET" && method !== "HEAD" && !sameSite(request)) {
      return json({ error: "Żądanie spoza strony." }, 403);
    }

    if (path === "/auth/logout" && method === "POST") {
      deleteSession(token, db);
      return json({ ok: true }, 200, { "Set-Cookie": CLEAR_COOKIE });
    }

    if (path === "/api/me") {
      return json({ user: viewer ? publicUser(viewer, db, now.toISOString()) : null });
    }

    // ---------------------------------------------------------------- highlights

    if (path === "/api/highlights" && method === "GET") {
      const platform = platformOf(url.searchParams.get("platform"));
      const channelLogin = url.searchParams.get("login");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (!channelLogin || !from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
        throw new HighlightError("Wymagane: platform, login, from, to.", 400);
      }
      return json({
        moments: listMoments({ platform, login: channelLogin }, from, to, viewer?.id ?? null, db),
      });
    }

    if (!viewer) return json({ error: "Zaloguj się." }, 401);
    const role = roleOf(viewer, db);

    if (path === "/api/highlights" && method === "POST") {
      const input = await body(request);
      const channel = input.channel as { platform?: unknown; login?: unknown } | undefined;
      const platform = platformOf(channel?.platform);
      if (typeof channel?.login !== "string" || channel.login.trim() === "") {
        throw new HighlightError("Brak kanału.", 400);
      }
      const kind = HIGHLIGHT_KINDS.includes(input.kind as HighlightKind) ? (input.kind as HighlightKind) : "other";
      const target = { platform, login: channel.login.trim().toLowerCase() };
      const id = createHighlight(
        viewer,
        {
          channel: target,
          kind,
          note: cleanNote(input.note),
          back: typeof input.back === "number" ? input.back : 0,
          at: typeof input.at === "string" ? input.at : undefined,
        },
        getLiveBroadcast(platform, target.login),
        db,
        now,
      );
      return json({ id }, 201);
    }

    const own = /^\/api\/highlights\/(\d+)$/.exec(path);
    if (own && method === "DELETE") {
      deleteOwnHighlight(viewer, Number(own[1]), db);
      return json({ ok: true });
    }

    const report = /^\/api\/highlights\/(\d+)\/report$/.exec(path);
    if (report && method === "POST") {
      const input = await body(request);
      const result = reportHighlight(
        viewer,
        Number(report[1]),
        typeof input.reason === "string" ? input.reason : null,
        db,
        now.toISOString(),
      );
      return json(result);
    }

    // ---------------------------------------------------------------- moderation

    if (!path.startsWith("/api/mod/")) return json({ error: "Nie znaleziono." }, 404);
    if (!isModerator(role)) return json({ error: "Brak uprawnień." }, 403);

    if (path === "/api/mod/highlights" && method === "GET") {
      const status = url.searchParams.get("status");
      const userParam = url.searchParams.get("user");
      const rows = listForModeration(
        {
          status: status === "hidden" || status === "all" ? status : "reported",
          userId: userParam && /^\d+$/.test(userParam) ? Number(userParam) : undefined,
        },
        db,
      );
      return json({
        highlights: rows.map((row) => ({
          id: row.id,
          at: row.at,
          createdAt: row.created_at,
          source: row.source,
          kind: row.kind,
          note: row.note,
          noteRemoved: row.note_removed === 1,
          hidden: row.hidden === 1,
          hiddenReason: row.hidden_reason,
          channel: { platform: row.channel_platform, login: row.channel_login },
          user: { id: row.user_id, platform: row.platform, login: row.login, display: row.display ?? row.login },
          openReports: row.open_reports,
          reportReasons: row.report_reasons ? row.report_reasons.split(" | ") : [],
        })),
      });
    }

    const modMark = /^\/api\/mod\/highlights\/(\d+)$/.exec(path);
    if (modMark && method === "POST") {
      const input = await body(request);
      const action = input.action as ModAction;
      if (!["hide", "restore", "remove_note", "delete"].includes(action)) {
        throw new HighlightError("Nieznana akcja.", 400);
      }
      moderateHighlight(
        viewer,
        Number(modMark[1]),
        action,
        typeof input.reason === "string" ? input.reason.slice(0, 200) : null,
        db,
        now.toISOString(),
      );
      return json({ ok: true });
    }

    if (path === "/api/mod/users" && method === "GET") {
      const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
      const rows = db
        .query(
          `SELECT u.*,
             (SELECT COUNT(*) FROM highlights h WHERE h.user_id = u.id AND h.deleted = 0) AS marks,
             (SELECT COUNT(*) FROM highlights h WHERE h.user_id = u.id AND h.hidden = 1) AS hidden_marks,
             (SELECT COUNT(*) FROM highlight_reports r JOIN highlights h ON h.id = r.highlight_id
               WHERE h.user_id = u.id) AS reports_received
           FROM users u
           WHERE ?1 = '' OR u.login LIKE ?2 OR lower(u.display) LIKE ?2
           ORDER BY u.last_login_at DESC LIMIT 100`,
        )
        .all(q, `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) as (UserRow & {
        marks: number;
        hidden_marks: number;
        reports_received: number;
      })[];
      return json({
        users: rows.map((row) => ({
          ...publicUser(row, db, now.toISOString()),
          marks: row.marks,
          hiddenMarks: row.hidden_marks,
          reportsReceived: row.reports_received,
          lastLoginAt: row.last_login_at,
        })),
      });
    }

    const modUser = /^\/api\/mod\/users\/(\d+)\/(mute|unmute|role)$/.exec(path);
    if (modUser && method === "POST") {
      const target = getUser(Number(modUser[1]), db);
      if (!target) throw new HighlightError("Nie ma takiego użytkownika.", 404);
      const targetRole = roleOf(target, db);
      const input = await body(request);
      const reason = typeof input.reason === "string" ? input.reason.slice(0, 200) : null;

      if (modUser[2] === "role") {
        if (role !== "admin") return json({ error: "Tylko admin nadaje role." }, 403);
        if (targetRole === "admin") throw new HighlightError("Admina ustawia konfiguracja.", 400);
        const grant = input.mod === true;
        setModerator(target.id, grant, viewer.id, db, now.toISOString());
        logModAction(
          { actorUserId: viewer.id, action: grant ? "user.grant_mod" : "user.revoke_mod", targetType: "user", targetId: target.id },
          db,
          now.toISOString(),
        );
        return json({ ok: true });
      }

      // A mod may not sanction another mod or an admin; only an admin may.
      if (isModerator(targetRole) && role !== "admin") {
        return json({ error: "Moderatora może ukarać tylko admin." }, 403);
      }
      if (targetRole === "admin") throw new HighlightError("Nie można wyciszyć admina.", 400);

      if (modUser[2] === "unmute") {
        unmuteUser(target.id, db, now.toISOString());
        logModAction({ actorUserId: viewer.id, action: "user.unmute", targetType: "user", targetId: target.id }, db, now.toISOString());
        return json({ ok: true });
      }

      const minutes = input.minutes === null ? null : Number(input.minutes);
      if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 525_600)) {
        throw new HighlightError("Czas blokady: 1 minuta – 1 rok, albo na stałe.", 400);
      }
      muteUser(target.id, minutes, reason, viewer.id, db, now);
      const hidden = input.hideMarks === true ? hideAllByUser(target.id, "wyciszenie", db) : 0;
      logModAction(
        { actorUserId: viewer.id, action: "user.mute", targetType: "user", targetId: target.id, details: { minutes, reason, hidden } },
        db,
        now.toISOString(),
      );
      return json({ ok: true, hidden });
    }

    if (path === "/api/mod/log" && method === "GET") {
      if (role !== "admin") return json({ error: "Dziennik widzi tylko admin." }, 403);
      const rows = db
        .query(
          `SELECT a.*, u.login, u.display, u.platform FROM mod_actions a
             JOIN users u ON u.id = a.actor_user_id
            ORDER BY a.created_at DESC, a.id DESC LIMIT 200`,
        )
        .all() as {
        id: number;
        action: string;
        target_type: string;
        target_id: number | null;
        details: string | null;
        created_at: string;
        login: string;
        display: string | null;
        platform: Platform;
      }[];
      return json({
        actions: rows.map((row) => ({
          id: row.id,
          action: row.action,
          targetType: row.target_type,
          targetId: row.target_id,
          details: row.details ? JSON.parse(row.details) : null,
          createdAt: row.created_at,
          actor: { platform: row.platform, login: row.login, display: row.display ?? row.login },
        })),
      });
    }

    return json({ error: "Nie znaleziono." }, 404);
  } catch (error) {
    if (error instanceof HighlightError) return json({ error: error.message }, error.status);
    throw error;
  }
}
