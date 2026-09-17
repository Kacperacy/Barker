import type { Platform } from "../types";
import { toKickSlug } from "../kick/api";

export interface StreamRecorderTarget {
  platform: Platform;
  login: string;
}

const PLATFORMS: Platform[] = ["twitch", "kick"];

// StreamRecorder addresses a channel by its Twitch login or its Kick slug — the
// same normalization the chat targets use, so "kick:Klaun_0k" matches what their
// feed reports.
export function normalizeStreamRecorderLogin(
  platform: Platform,
  login: string,
): string {
  return platform === "kick" ? toKickSlug(login) : login.trim().toLowerCase();
}

// Throws rather than skipping a malformed entry, like the chat targets: a channel
// that silently is not tracked shows up as VODs that were never stored, long
// after the recording is gone.
export function parseStreamRecorderTargets(raw: string): StreamRecorderTarget[] {
  const targets: StreamRecorderTarget[] = [];
  const seen = new Set<string>();

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      throw new Error(
        `Invalid STREAMRECORDER_CHANNELS entry "${trimmed}": expected "<platform>:<login>", e.g. "kick:somestreamer"`,
      );
    }

    const platform = trimmed.slice(0, separatorIndex).trim().toLowerCase();
    const rawLogin = trimmed.slice(separatorIndex + 1);

    if (!PLATFORMS.includes(platform as Platform)) {
      throw new Error(
        `Invalid STREAMRECORDER_CHANNELS entry "${trimmed}": unknown platform "${platform}" (expected ${PLATFORMS.join(" or ")})`,
      );
    }

    const login = normalizeStreamRecorderLogin(platform as Platform, rawLogin);
    if (login === "") {
      throw new Error(
        `Invalid STREAMRECORDER_CHANNELS entry "${trimmed}": missing login after "${platform}:"`,
      );
    }

    const key = `${platform}:${login}`;
    if (seen.has(key)) continue;
    seen.add(key);

    targets.push({ platform: platform as Platform, login });
  }

  return targets;
}

export function isStreamRecorderTarget(
  targets: StreamRecorderTarget[],
  platform: Platform,
  login: string,
): boolean {
  const normalized = normalizeStreamRecorderLogin(platform, login);
  return targets.some(
    (target) => target.platform === platform && target.login === normalized,
  );
}
