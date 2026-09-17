import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearLiveBroadcast,
  getLiveBroadcast,
  offsetSeconds,
  resetLiveBroadcasts,
  setLiveBroadcast,
} from "./live";

beforeEach(() => {
  resetLiveBroadcasts();
});

describe("live broadcast state", () => {
  test("remembers the broadcast a channel is in, case-insensitively", () => {
    setLiveBroadcast("twitch", "Alice", {
      streamId: "stream-1",
      startedAt: "2026-01-01T10:00:00Z",
    });

    expect(getLiveBroadcast("twitch", "alice")).toEqual({
      streamId: "stream-1",
      startedAt: "2026-01-01T10:00:00Z",
    });
  });

  test("keeps platforms apart", () => {
    setLiveBroadcast("twitch", "alice", {
      streamId: "t-1",
      startedAt: "2026-01-01T10:00:00Z",
    });
    expect(getLiveBroadcast("kick", "alice")).toBeNull();
  });

  test("clears on offline, so later messages are not stamped with a dead stream", () => {
    setLiveBroadcast("kick", "alice", {
      streamId: "k-1",
      startedAt: "2026-01-01T10:00:00Z",
    });
    clearLiveBroadcast("kick", "alice");
    expect(getLiveBroadcast("kick", "alice")).toBeNull();
  });
});

describe("offsetSeconds", () => {
  test("measures the message from the start of the broadcast", () => {
    expect(offsetSeconds("2026-01-01T10:00:00Z", "2026-01-01T10:05:30Z")).toBe(330);
  });

  test("returns null rather than zero when a timestamp is unusable", () => {
    // Zero would read as "sent at go-live" in a replay, which is a lie about the
    // one thing this number exists for.
    expect(offsetSeconds("nonsense", "2026-01-01T10:05:30Z")).toBeNull();
    expect(offsetSeconds("2026-01-01T10:00:00Z", "nonsense")).toBeNull();
  });
});