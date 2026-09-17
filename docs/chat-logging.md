# Chat logging

Saves the chat of tracked channels (messages, bans, timeouts) and serves it to the
viewing front end. `klaun-live`'s subpage reads it; the same rows are what a later
"chat beside the VOD" step will replay.

## Forward-only by nature

Neither platform will give you chat after the fact:

- **Kick's public API has no chat-read endpoint at all.** Messages, bans and
  timeouts only arrive as webhooks, so the log starts when the subscriptions do.
- **Twitch publishes no message history.** `channel.chat.message` is a live feed.

Messages sent while the bot was down are gone; there is nothing to backfill them
from. That is a platform limit, not a switch that was left off.

## How it fits together

```
Twitch IRC (anonymous) ──────┐
                             ├─► chat_messages / moderation_events (SQLite, WAL)
Kick webhooks (HTTPS) ───────┘        │
                                      └─► GET /api/chat/* ──► klaun-live `/chat`
```

One listener serves both directions: `POST /webhooks/kick` receives Kick's
events, and `/api/chat/*` is what the front end reads.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `CHAT_LOG_ENABLED` | `false` | Master switch. |
| `CHAT_LOG_CHANNELS` | `""` | `twitch:klaun___0k,kick:klaun-0k`. A malformed entry stops startup rather than logging a channel with holes in it. |
| `CHAT_LOG_HIDDEN_CHANNELS` | `""` | Same format, for channels that are logged but not shown: the `/api/chat/targets` list and every `/api/chat/*` query that does not name a channel skip them, so a dev channel never appears on the site or in its totals. `?login=…` still reads one. |
| `CHAT_LOG_RETENTION_DAYS` | `0` | `0` keeps everything. Prunes messages only; moderation rows are never dropped. |
| `API_PORT` | `3001` | Serves the read API and the webhook. |
| `PUBLIC_BASE_URL` | `""` | Printed in the log as the webhook URL to register. |
| `READ_API_TOKEN` | `""` | Empty leaves the read API public. Set it to require `Authorization: Bearer` or `?token=`. |
| `KICK_WEBHOOK_PUBLIC_KEY` | `""` | Pin the signing key; empty fetches it from Kick and caches it for a day. |

## No authorization needed

This is built to be run by someone **outside** the channel — a viewer, not the
broadcaster — so neither platform asks for an account with moderator powers:

- **Twitch** is read over **anonymous IRC**: `PASS SCHMOOPIIE` with a
  `justinfanNNNN` nick, joining the channel the way any other viewer does. No
  token, no scopes, no OAuth app. It carries messages with their tags (badges,
  colour, display name, reply target, and Twitch's own send timestamp), and —
  because CLEARCHAT and CLEARMSG go to the whole room — bans, timeouts and
  single-message deletions too. EventSub chat topics are deliberately not used:
  they need `user:read:chat` as the broadcaster or a bot the broadcaster has
  granted `channel:bot`, neither of which a viewer can obtain.
- **Kick** is subscribed to with the app's own **client-credentials token**, with
  the channel named explicitly. Kick's subscribe endpoint documents
  `broadcaster_user_id` as required when an app access token is used — with a user
  token the broadcaster would be inferred from the token, which only the channel's
  owner can have.

So the whole setup is configuration (`CHAT_LOG_ENABLED`, `CHAT_LOG_CHANNELS`,
`CHAT_LOG_HIDDEN_CHANNELS`) plus
a public HTTPS URL for Kick's webhooks, below. Startup logs which channels it is
following and over which transport, so an empty log is never ambiguous.

## Kick webhooks

Kick's only transport is a webhook, so `API_PORT` has to be reachable from the
internet through whatever fronts the VPS:

1. Create a proxy host for the API (nginx-proxy-manager or similar) and give it a
   certificate — Kick will not deliver to plain HTTP.
2. Put the public URL in `PUBLIC_BASE_URL`; the startup log prints the exact
   `…/webhooks/kick` URL to check subscriptions against.
3. Nothing else: the bot subscribes to `chat.message.sent`, `moderation.banned`
   and `livestream.status.updated` itself, and re-checks every six hours, because
   Kick unsubscribes an endpoint that fails for a day.

Every delivery is verified against Kick's RSA public key over
`{message-id}.{timestamp}.{raw body}`. An unsigned, tampered or stale-key delivery
is rejected with 401/503 and nothing is written — the alternative is a stranger
posting bans into the log. Deliveries are idempotent on the platform's own ids.

## Endpoints

| Endpoint | Returns |
| --- | --- |
| `GET /api` | The endpoint index — enough to explore the API without reading this repository. |
| `GET /api/openapi.json` | The same contract as an OpenAPI 3.1 document, for generating a client. |
| `GET /health` | `{ ok, chatLogging }` |
| `GET /api/chat/targets` | The channels configured for logging, including ones that have produced nothing yet. `includeHidden` adds the hidden ones, flagged `hidden`. |
| `GET /api/chat/messages` | `author`, `q`, paging; newest first with a `total`. |
| `GET /api/moderation/events` | `action`, `target`, paging. |
| `GET /api/chat/stats` | Chat totals and buckets plus ban/timeout counts in one call — the subpage's summary. |
| `GET /api/moderation/stats` | The moderation half on its own. |
| `GET /api/chat/series` | `groupBy` (`day`, `hour`, `weekday`, `author`, `channel`, `platform`, `stream`), `metric` (`messages`, `chatters`), `order` (`key`/`value`), `limit`. |
| `GET /api/moderation/series` | The same for moderation: `groupBy` (`day`, `hour`, `weekday`, `target`, `actor`, `action`, `channel`, `platform`, `stream`), `metric` (`events`, `bans`, `timeouts`, `targets`). |

Every read endpoint takes the same filters — `platform`, `login`, `from`, `to`,
`streamId`, `includeHidden` — and the same window: `days` counted back from now,
or an absolute `from`/`to`, where `from` wins. Timestamps and bounds are
inclusive, and each row answers with the platform's own send time rather than
when we stored it.

Two series queries are worth knowing, because they are how a client finds out
what is in the log at all: `groupBy=channel` lists every channel with a message
count and its first and last message, and `groupBy=stream` does the same per
broadcast — which is what a per-broadcast chat replay is built on.

A parameter that is present but wrong is answered with a `400` naming it: an
unknown `groupBy`, `action` or `platform`, a `limit` that is not a number, a
`from` that is not a timestamp. Nothing is silently ignored, because quietly
answering a different question than the one asked is the failure mode a public
API cannot afford.

The contract is additive-only — parameters, response fields and endpoints are
added, never repurposed — and `/api/openapi.json` is what it is measured
against. Hidden channels are out of `/api/chat/targets` and out of every query
that does not pass `includeHidden`, which is what keeps a dev channel off the
site while leaving it readable to tooling.

## Storage

`chat_messages` keeps one row per message, `moderation_events` one row per action
(ban, timeout, unban, message delete, chat clear). Messages are written in one
batched transaction per second — a busy chat delivers faster than one fsync per
line is worth — and both tables are keyed so a redelivered event cannot duplicate.

Rows carry the broadcast they belong to (`stream_id`, `stream_started_at`,
`offset_seconds`), taken from the go-live signals the bot already consumes. That
is what makes chat replay beside an archived VOD possible; nothing else in the
schema needs to change for it.

## Known limitations

- **Kick has no unban or message-deleted event.** An unban or timeout being lifted
  is invisible, so the moderation log is asymmetric by platform, not by choice.
- **Twitch's IRC says a ban happened, not who did it or why.** CLEARCHAT carries
  the target and, for a timeout, its length in seconds — no moderator and no
  reason, because Twitch exposes no moderation history to anyone outside the
  channel. Both stay null.
- The anonymous Twitch connection has no privileges, so anything a moderator sees
  and the room does not (a whispered warning, a deleted-by-author message) never
  reaches the log.
- A Kick stream whose bot restart straddles a live broadcast can miss the first
  messages of that broadcast; the subscription is restored on the next check.
