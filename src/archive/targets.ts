import type { Platform } from "../types";
import { toKickSlug } from "../kick/api";

export interface ArchiveTarget {
  platform: Platform;
  login: string;
}

const PLATFORMS: Platform[] = ["twitch", "kick"];

// Twitch logins are simply lowercased, but Kick addresses channels by slug —
// see toKickSlug in kick/api.ts. Normalizing on both the config side and the
// lookup side is what lets an underscore-containing username typed into
// ARCHIVE_STREAMERS match the hyphenated slug the polling loop reports.
export function normalizeArchiveLogin(
  platform: Platform,
  login: string,
): string {
  return platform === "kick" ? toKickSlug(login) : login.trim().toLowerCase();
}

// Throws rather than skipping malformed entries: a silently dropped target
// only surfaces as a missing VOD long after the stream is unrecoverable,
// so a typo has to stop the process at startup the way config.ts does.
export function parseArchiveTargets(raw: string): ArchiveTarget[] {
  const targets: ArchiveTarget[] = [];
  const seen = new Set<string>();

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      throw new Error(
        `Invalid ARCHIVE_STREAMERS entry "${trimmed}": expected "<platform>:<login>", e.g. "twitch:somestreamer"`,
      );
    }

    const platform = trimmed.slice(0, separatorIndex).trim().toLowerCase();
    const rawLogin = trimmed.slice(separatorIndex + 1);

    if (!PLATFORMS.includes(platform as Platform)) {
      throw new Error(
        `Invalid ARCHIVE_STREAMERS entry "${trimmed}": unknown platform "${platform}" (expected ${PLATFORMS.join(" or ")})`,
      );
    }

    const login = normalizeArchiveLogin(platform as Platform, rawLogin);
    if (login === "") {
      throw new Error(
        `Invalid ARCHIVE_STREAMERS entry "${trimmed}": missing login after "${platform}:"`,
      );
    }

    const key = `${platform}:${login}`;
    if (seen.has(key)) continue;
    seen.add(key);

    targets.push({ platform: platform as Platform, login });
  }

  return targets;
}

export function shouldArchive(
  targets: ArchiveTarget[],
  platform: Platform,
  login: string,
): boolean {
  const normalized = normalizeArchiveLogin(platform, login);
  return targets.some(
    (target) => target.platform === platform && target.login === normalized,
  );
}
