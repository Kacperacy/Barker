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

## StreamRecorder VODs

Reads StreamRecorder.io's public recordings feed for the channels in
`STREAMRECORDER_CHANNELS` and stores each recording with its own status
(`streamrecorder_vods`), so `/vods` can list broadcasts that outlive the
platform's copy. Nothing is recorded here — their site does the recording, and
this keeps a searchable copy of the metadata plus, where they publish one, a
playback URL. See `src/streamrecorder/polling.ts` for what their public surface
allows: a global feed that cannot be filtered by channel, a per-channel list that
is account-only, and a signed, expiring MP4 for a channel's newest recording.

## Chat logging

Saves chat messages, bans and timeouts for tracked channels and serves them to the
viewing front end from `API_PORT`, where the same listener also receives Kick's
webhook events. Nothing here needs an account belonging to the channel: Twitch is
read over anonymous IRC and Kick is subscribed to with the app's own token, so
anyone who can watch a channel can log its chat. See
[docs/chat-logging.md](docs/chat-logging.md) for the setup — the public HTTPS URL
Kick requires is the only piece of infrastructure — and for the limits that matter
most: neither platform will backfill chat, so the log starts when you switch it on;
Kick never reports a lifted ban; and Twitch's IRC says that a ban happened without
saying who issued it.
