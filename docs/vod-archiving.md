# VOD archiving

Records tracked streams as they air and uploads them to remote storage, so the
recording survives the streamer deleting their VOD.

## Why it records live

Downloading the VOD after the stream ends does not meet that goal:

- An m3u8 is a manifest, not video. Once the CDN purges the `.ts` segments it
  points at, the manifest is worthless.
- On Twitch the VOD can be deleted seconds after the stream ends, and only
  exists at all if the streamer has VOD storage enabled.
- Kick's public API has no VOD endpoint whatsoever.

The only copy that reliably survives is one on your own disk, so the recorder
captures the live stream from go-live to offline. Post-hoc VOD recovery exists
as a fallback (see below) but is not the primary path.

## How it fits together

```
bot                                   recorder
  go-live  ──┐
             ├─► vod_archives (SQLite, WAL) ──► streamlink → ffmpeg -f segment
  offline ───┘                                        │
                                                      ├─► rclone → remote storage
                                                      └─► status page :3000
```

The bot only writes job rows; it never records. The recorder is a separate
container because it needs ffmpeg, streamlink and rclone, which have no place
in the bot's image.

### Segmentation is the disk strategy

The capture is cut into segments (default one hour). Each segment is uploaded
and **deleted locally** as soon as ffmpeg moves off it, so a multi-hour
broadcast never occupies more than one or two segments of disk regardless of
length. Verified on a live stream: seven segments uploaded, one 6 MB segment
on disk.

Segment numbering continues across restarts, so a capture that drops
mid-broadcast and resumes does not overwrite earlier parts.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `ARCHIVE_ENABLED` | `false` | Master switch, read by both containers. |
| `ARCHIVE_STREAMERS` | `""` | `twitch:name,kick:slug`. A malformed entry stops startup rather than silently skipping a streamer. |
| `ARCHIVE_QUALITY` | `best` | streamlink selector. `best` is source. |
| `ARCHIVE_SEGMENT_SECONDS` | `3600` | Lower caps peak disk use. |
| `ARCHIVE_WORK_DIR` | `/data/recordings` | Scratch space for segments in flight. |
| `ARCHIVE_MAX_CONCURRENT` | `1` | Simultaneous captures. |
| `ARCHIVE_MIN_FREE_DISK_GB` | `10` | Refuses to start a capture below this. |
| `ARCHIVE_RCLONE_REMOTE` | `gdrive:Barker VODs` | Any rclone destination. |
| `ARCHIVE_RCLONE_CONFIG` | `/config/rclone/rclone.conf` | Mounted read-only. |
| `ARCHIVE_RECOVERY_ENABLED` | `true` | Post-hoc VOD fallback. |
| `ARCHIVE_WEB_PORT` | `3000` | Status page. |

## Storage sizing

Measured on real streams: **Twitch 720p ≈ 1.5 GB/h, Kick 1080p ≈ 2.8 GB/h.**

One streamer at four hours a day is roughly 360 GB/month at source quality, or
190 GB/month at `720p60`. Archives accumulate, so a 2 TB Google Drive fills in
about five months at source and ten at 720p. There is no retention policy yet —
old broadcasts are never pruned.

Google Drive also caps uploads at 750 GB/day and consumer accounts at 30 TB.
Neither binds at one-streamer scale, but both do if this grows.

## Setting up rclone for Google Drive

Run this **on your own machine**, not the VPS — the OAuth flow never needs to
happen on the server:

```bash
rclone config
#  n) new remote, name: gdrive, storage: drive
#  Use your own client_id/client_secret from Google Cloud Console
#  scope: 3 (drive.file)
```

`drive.file` scope limits the token to files the application itself created —
it cannot read or delete anything else in your Drive. Copy the resulting
`rclone.conf` to `~/Barker/rclone/` on the VPS.

Any other rclone backend works too; only `ARCHIVE_RCLONE_REMOTE` changes.

## Status page

The recorder serves a read-only page on `ARCHIVE_WEB_PORT`: broadcast, status
(`recording` while live), upload progress, size and destination. `/api/vods`
returns the same as JSON. Expose it through nginx-proxy-manager as its own
proxy host, with an access list if it should not be public.

The bot serves those rows on its own read API as well, which is what the site
uses — one public surface instead of two, with the same filters and paging as the
chat endpoints:

| Endpoint | Returns |
| --- | --- |
| `GET /api/vods` | Broadcasts the recorder has archived, newest first. Filters: `platform`, `login` (the streamer), `status`, `from`, `to`, `limit` (≤500), `offset`. Each row carries `status`, `sizeBytes`, `parts` (`uploaded`/`total`), `endedAt`/`durationSeconds`, the `folder` the segments went to, and `error` when a capture or upload gave up. |
| `GET /api/openapi.json` | The contract, including the recording states `pending`, `recording`, `ended`, `uploading`, `done`, `failed` and `recovered`. |

Nothing in the read API serves video, and a row carries no stable playback URL
on purpose: the manifests the recorder captures (`live_m3u8`, `vod_m3u8`) expire,
and the segments are files in remote storage. Listing an archive is therefore
independent of deciding how to play it back.

## VOD recovery fallback

When a broadcast produced no segments — the recorder was down at go-live — it
tries to recover the VOD afterwards:

1. If the broadcast still has a published VOD, download that.
2. Otherwise reconstruct the CDN path from `sha1("{login}_{streamId}_{epoch}")`,
   probing a ±window around the reported start time because the VOD's internal
   timestamp drifts from the API's.

**Twitch only, and unreliable by nature.** The window for a deleted VOD is days
to a couple of weeks, and it depends on an undocumented Twitch implementation
detail that breaks periodically. Kick has no equivalent: a Kick stream the
recorder missed is gone.

## Known limitations

- Recording starts at go-live, so the first few seconds (Twitch) or up to one
  polling interval (Kick, 60 s) are missed.
- `--twitch-disable-ads` skips ads but can leave small seams.
- No retention policy; storage grows without bound.
