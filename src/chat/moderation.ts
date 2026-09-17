import type { ModerationAction } from "../database/repositories/moderationEvents";

export interface BanDetails {
  action: Extract<ModerationAction, "ban" | "timeout">;
  // Minutes, or null when the platform did not say (Kick always sends
  // expires_at for a timeout; Twitch's ban event carries ends_at).
  durationMinutes: number | null;
}

// One shape for both platforms, because they express the same thing
// differently:
//   Twitch — channel.ban carries `is_permanent` plus `ends_at` (null when
//            permanent, set for a timeout).
//   Kick   — moderation.banned carries `metadata.expires_at`, null for a
//            permanent ban and a timestamp for a timeout.
// A parseable expiry is therefore what decides it, and `isPermanent === false`
// without one still means a timeout, just of unknown length.
export function classifyBan(input: {
  startedAt: string;
  expiresAt?: string | null;
  isPermanent?: boolean | null;
}): BanDetails {
  const expires = input.expiresAt ? Date.parse(input.expiresAt) : Number.NaN;

  if (Number.isNaN(expires)) {
    return {
      action: input.isPermanent === false ? "timeout" : "ban",
      durationMinutes: null,
    };
  }

  const started = Date.parse(input.startedAt);
  const minutes = Number.isNaN(started)
    ? null
    : Math.max(1, Math.round((expires - started) / 60_000));

  return { action: "timeout", durationMinutes: minutes };
}
