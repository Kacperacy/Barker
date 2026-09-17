import { createHash } from "node:crypto";

// Deleted VODs disappear from the API before their segments leave the CDN, and
// the storage path is derived deterministically from the broadcast's identity —
// so it can be rebuilt and probed directly.
//
// This is an undocumented Twitch implementation detail, not an API. It works
// for days-to-weeks-old deletions at best, breaks periodically, and has no
// Kick equivalent. It is a fallback for broadcasts the recorder missed, never
// a substitute for capturing the stream live.
const CDN_DOMAINS = [
  "ds0h3roq6wcgc.cloudfront.net",
  "d2nvs31859zcd8.cloudfront.net",
  "d2aba1wr3818hz.cloudfront.net",
  "d3c27h4odz752x.cloudfront.net",
  "dgeft87wbj63p.cloudfront.net",
  "d1m7jfoe9zdc1j.cloudfront.net",
  "d3vd9lfkzbru3h.cloudfront.net",
  "ddacn6pr5v0tl.cloudfront.net",
  "d3aqoihi2n8ty8.cloudfront.net",
  "d3fi1amfgojobc.cloudfront.net",
  "d3stzm2eumvgb4.cloudfront.net",
  "d2vi6trrdongqn.cloudfront.net",
  "d1ndex63qxojbr.cloudfront.net",
];

// "chunked" is the source rendition; the rest are fallbacks for broadcasts
// whose source is already gone.
const QUALITIES = [
  "chunked",
  "1080p60",
  "1080p30",
  "720p60",
  "720p30",
  "480p30",
];

// The VOD's own start timestamp drifts from the one the API reports, so a
// window around it is probed rather than the single reported second.
const OFFSET_RANGE = { from: -30, to: 60 };

export function buildVodPathHash(
  login: string,
  streamId: string,
  epochSeconds: number,
): string {
  const base = `${login}_${streamId}_${epochSeconds}`;
  return createHash("sha1").update(base).digest("hex").slice(0, 20);
}

export function buildVodBasePaths(
  login: string,
  streamId: string,
  startedAt: string,
): string[] {
  const startedEpoch = Math.floor(Date.parse(startedAt) / 1000);
  if (Number.isNaN(startedEpoch)) return [];

  const paths: string[] = [];

  for (let offset = OFFSET_RANGE.from; offset <= OFFSET_RANGE.to; offset++) {
    const epoch = startedEpoch + offset;
    const hash = buildVodPathHash(login, streamId, epoch);
    paths.push(`${hash}_${login}_${streamId}_${epoch}`);
  }

  return paths;
}

// Ordered cheapest-first: the source rendition on every domain before falling
// back to lower qualities, so a hit on "chunked" is found early.
export function buildVodCandidateUrls(
  login: string,
  streamId: string,
  startedAt: string,
): string[] {
  const basePaths = buildVodBasePaths(login, streamId, startedAt);
  const urls: string[] = [];

  for (const quality of QUALITIES) {
    for (const domain of CDN_DOMAINS) {
      for (const basePath of basePaths) {
        urls.push(`https://${domain}/${basePath}/${quality}/index-dvr.m3u8`);
      }
    }
  }

  return urls;
}

export function buildVideoUrl(videoId: string): string {
  return `https://twitch.tv/videos/${videoId}`;
}

export interface ProbeDeps {
  // Resolves true when the URL serves a playlist.
  exists: (url: string) => Promise<boolean>;
  concurrency?: number;
}

export const defaultProbeDeps: ProbeDeps = {
  exists: async (url) => {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  },
};

// Thousands of candidates get probed, so they run in bounded parallel batches
// and stop the moment one hits.
export async function findExistingVodUrl(
  urls: string[],
  deps: ProbeDeps = defaultProbeDeps,
): Promise<string | null> {
  const batchSize = deps.concurrency ?? 20;

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    // One unreachable domain among thousands of candidates must not abort the
    // whole search, so a throwing probe counts as a miss.
    const results = await Promise.all(
      batch.map(async (url) => {
        try {
          return (await deps.exists(url)) ? url : null;
        } catch {
          return null;
        }
      }),
    );

    const hit = results.find((url): url is string => url !== null);
    if (hit) return hit;
  }

  return null;
}
