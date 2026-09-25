# Site accounts, highlights and moderation

klaun.live viewers can log in with Kick or Twitch and mark highlights ("this was
a moment") while watching the stream or a recording. Marks by different people
within 90 s of each other are shown as one moment with a count. Everything is
served by Barker through the site's same-origin `/barker` proxy, so the session
cookie is first-party on the site.

## Setup

1. Register the redirect URLs with the platform apps Barker already uses
   (`KICK_CLIENT_ID`, `TWITCH_CLIENT_ID`):
   - Kick: `https://www.klaun.live/barker/auth/kick/callback`
   - Twitch: `https://www.klaun.live/barker/auth/twitch/callback`
2. Environment:

| Variable | Default | Notes |
| --- | --- | --- |
| `SITE_URL` | `https://www.klaun.live` | Builds the OAuth redirect URLs. |
| `SITE_ORIGINS` | `https://www.klaun.live,https://klaun.live` | Origins allowed to send state-changing requests (add a localhost origin for local development). |
| `ADMIN_ACCOUNTS` | `""` | `kick:<slug>,twitch:<login>` — full control: roles and the audit log. |
| `HIGHLIGHT_LIVE_DELAY_S` | `20` | How far the live embed lags; a live mark is placed this long before the click. |
| `HIGHLIGHT_BANNED_WORDS` | `""` | Comma-separated words a note may not contain (case/diacritics-insensitive). |

## Login

`/auth/{kick|twitch}/start?return=/path` → the platform → `/auth/{platform}/callback`.
Kick uses PKCE (required there); Twitch does not document it, and both are
guarded by a single-use `state` that expires after 10 minutes. The platform
access token is used once to read the profile and then dropped — Barker keeps
no platform tokens. The session cookie (`klaun_session`, HttpOnly, Secure,
SameSite=Lax, 30 days) holds a random token; the database stores its SHA-256.

`GET /api/me` → `{ user: { id, platform, login, display, avatar, role, muted } | null }`;
`POST /auth/logout`.

## Highlights

- `GET /api/highlights?platform&login&from&to` → `{ moments: [{ at, count, kind, marks }] }` (public).
- `POST /api/highlights` `{ channel: { platform, login }, kind, note?, back? | at? }`:
  live marks need the channel live and are placed `HIGHLIGHT_LIVE_DELAY_S + back`
  (0/30/60) seconds before now; recording marks pass `at` (in the past, at most
  90 days back).
- `DELETE /api/highlights/:id` (own), `POST /api/highlights/:id/report` `{ reason }`.

Kinds: `hype`, `funny`, `drama`, `music`, `other`. Notes: up to 80 characters,
no links, no `HIGHLIGHT_BANNED_WORDS`.

## Abuse protection and moderation

Marks are public immediately, so:

- **Limits:** one mark per 30 s and 30 per 12 h per viewer (moderators exempt).
- **Chat bans carry over:** a viewer banned, or timed out right now, in the
  channel's chat (from Barker's moderation log) cannot mark.
- **Reports:** one per viewer per mark; 3 open reports hide the mark until a
  moderator decides.
- **Roles:** admins from `ADMIN_ACCOUNTS`; moderators granted by an admin
  (`POST /api/mod/users/:id/role { mod }`). A moderator cannot sanction another
  moderator or an admin.
- **Moderator actions** (`/api/mod/...`): the report queue and all/hidden marks
  (`GET /api/mod/highlights?status=reported|hidden|all&user=`), `hide`, `restore`,
  `remove_note`, `delete` on a mark, user search (`GET /api/mod/users?q=`),
  `mute` (minutes or permanent, optionally hiding all their marks) and `unmute`.
  Every decision resolves the mark's open reports.
- **Audit log:** every moderator action is recorded (`mod_actions`), readable by
  admins at `GET /api/mod/log`.
- **Cross-site requests:** state-changing requests must carry an `Origin` from
  `SITE_ORIGINS`, on top of the SameSite cookie.

## Rate limits and other hardening

Every request is counted per claimed client (the address before the proxy's
own hop in `X-Forwarded-For`) and per peer (the proxy's last hop — a Vercel
edge, or a direct caller), the peer limit being 20× the client's so a direct
caller faking client addresses is still capped. Over a limit: `429` with
`Retry-After`.

| Kind | Per client |
| --- | --- |
| Login start / callback | 20 per 10 min |
| Reports, CSP reports | 10 per min |
| Other writes | 60 per min |
| Reads | 240 per min |

Kick's signed webhooks and `/health` are not throttled. Also:

- Request bodies are capped at 256 KB.
- A login's `return` path must be a plain same-site path; tabs, newlines and
  backslashes (which browsers turn into `//other-site`) are refused.
- Reports: 20 per viewer per day, none from a blocked viewer.
- `GET /api/highlights` windows are at most 62 days and 2000 marks.
- Expired sessions are purged on each login.
- `POST /csp-report` receives the site's Content-Security-Policy violation
  reports and logs each distinct one at most hourly.
- `POST /client-error` receives uncaught errors from the site's visitors
  (`{ kind, message, stack, path, release }`, 10 kB max) and logs one line per
  distinct message and page per hour: `[client error] <message> @ <path>
  (<build>) <top stack frame>`. Throttled like the report endpoints; nothing
  about the visitor is stored.

## Recordings and short links

`recordings` holds the logged channels' VODs on both platforms, re-read every
`RECORDING_SYNC_INTERVAL_MS` (10 min) and a few minutes after a stream ends:
Kick from `kick.com/api/v2/channels/<slug>/videos` (what Kick still keeps),
Twitch from Helix `GET /videos?type=archive` (7–60 days). A recording the
platform stops listing is kept with `gone: true`.

- `GET /api/recordings?channel=kick:<slug>&channel=twitch:<login>` — newest first.
- `GET /api/recordings/at?t=<unix>&channel=…` — the recordings covering that
  second (60 s slack) with the `offset` into each, plus `live` when the second
  belongs to a stream still running. The site's short links (`/m/<time>`,
  `/vod/<start>`) are resolved with it.
