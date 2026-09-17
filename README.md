# barker

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.13. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Chat logging

Saves chat messages, bans and timeouts for tracked channels and serves them to the
viewing front end from `API_PORT`, where the same listener also receives Kick's
webhook events. See [docs/chat-logging.md](docs/chat-logging.md) for the setup —
the one-time authorization on both platforms, and the public HTTPS URL Kick
requires — and for the limits that matter most: neither platform will backfill
chat, so the log starts when you switch it on, and Kick never reports a lifted
ban.
