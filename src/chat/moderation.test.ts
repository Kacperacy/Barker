import { describe, expect, test } from "bun:test";
import { classifyBan } from "./moderation";

describe("classifyBan", () => {
  test("treats a missing expiry as a permanent ban", () => {
    expect(
      classifyBan({ startedAt: "2026-01-01T10:00:00Z", expiresAt: null, isPermanent: true }),
    ).toEqual({ action: "ban", durationMinutes: null });
  });

  test("derives the timeout length from the expiry", () => {
    expect(
      classifyBan({
        startedAt: "2026-01-01T10:00:00Z",
        expiresAt: "2026-01-01T10:10:00Z",
        isPermanent: false,
      }),
    ).toEqual({ action: "timeout", durationMinutes: 10 });
  });

  test("still reads as a timeout when the expiry is unparseable", () => {
    // Twitch sends is_permanent: false for a timeout; if ends_at is missing or
    // malformed the length is unknown, but the action is not.
    expect(
      classifyBan({ startedAt: "2026-01-01T10:00:00Z", expiresAt: "not a date", isPermanent: false }),
    ).toEqual({ action: "timeout", durationMinutes: null });
  });

  test("rounds a sub-minute timeout up rather than reporting zero", () => {
    const details = classifyBan({
      startedAt: "2026-01-01T10:00:00Z",
      expiresAt: "2026-01-01T10:00:20Z",
    });
    expect(details).toEqual({ action: "timeout", durationMinutes: 1 });
  });

  test("handles an unparseable start without inventing a duration", () => {
    expect(
      classifyBan({ startedAt: "nonsense", expiresAt: "2026-01-01T10:10:00Z" }),
    ).toEqual({ action: "timeout", durationMinutes: null });
  });
});