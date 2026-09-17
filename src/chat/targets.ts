import type { Platform } from "../types";
import { toKickSlug } from "../kick/api";

export interface ChatLogTarget {
  platform: Platform;
  login: string;
}

const PLATFORMS: Platform[] = ["twitch", "kick"];

// The same normalization the archiving targets use (see archive/targets.ts):
// Twitch logins are lowercased, Kick channels are addressed by slug, so an
// underscore-containing username typed into CHAT_LOG_CHANNELS still matches the
// hyphenated slug every platform payload reports.
export function normalizeChatLogin(platform: Platform, login: string): string {
  return platform === "kick" ? toKickSlug(login) : login.trim().toLowerCase();
}

// Throws rather than skipping malformed entries, exactly like
// parseArchiveTargets: a silently dropped channel only shows up as a chat log
// with holes in it, long after those messages are gone for good.
export function parseChatTargets(raw: string): ChatLogTarget[] {
  const targets: ChatLogTarget[] = [];
  const seen = new Set<string>();

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) {
      throw new Error(
        `Invalid CHAT_LOG_CHANNELS entry "${trimmed}": expected "<platform>:<login>", e.g. "twitch:somestreamer"`,
      );
    }

    const platform = trimmed.slice(0, separatorIndex).trim().toLowerCase();
    const rawLogin = trimmed.slice(separatorIndex + 1);

    if (!PLATFORMS.includes(platform as Platform)) {
      throw new Error(
        `Invalid CHAT_LOG_CHANNELS entry "${trimmed}": unknown platform "${platform}" (expected ${PLATFORMS.join(" or ")})`,
      );
    }

    const login = normalizeChatLogin(platform as Platform, rawLogin);
    if (login === "") {
      throw new Error(
        `Invalid CHAT_LOG_CHANNELS entry "${trimmed}": missing login after "${platform}:"`,
      );
    }

    const key = `${platform}:${login}`;
    if (seen.has(key)) continue;
    seen.add(key);

    targets.push({ platform: platform as Platform, login });
  }

  return targets;
}

export function isChatLogTarget(
  targets: ChatLogTarget[],
  platform: Platform,
  login: string,
): boolean {
  const normalized = normalizeChatLogin(platform, login);
  return targets.some(
    (target) => target.platform === platform && target.login === normalized,
  );
}
