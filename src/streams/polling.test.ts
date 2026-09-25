import { beforeEach, describe, expect, test } from "bun:test";
import { runMigrations } from "../database/migrations/index";
import { db } from "../database/connection";
import { getLiveBroadcast, resetLiveBroadcasts } from "../chat/live";
import { listStreams, listViewerSamples } from "../database/repositories/streams";
import { pollStreamsOnce, type LiveSnapshot } from "./polling";
import type { Platform } from "../types";

// test/setup.ts logs twitch:alice and kick:alice.
runMigrations();

beforeEach(() => {
  resetLiveBroadcasts();
  db.query("DELETE FROM streams").run();
  db.query("DELETE FROM stream_viewer_samples").run();
});

function liveOn(kick: LiveSnapshot | null | undefined) {
  return async (platform: Platform, logins: string[]) => {
    const map = new Map<string, LiveSnapshot | null>();
    if (platform === "kick" && kick !== undefined) for (const login of logins) map.set(login, kick);
    if (platform === "twitch") for (const login of logins) map.set(login, null);
    return map;
  };
}

const snapshot = (viewers: number, title = "siema"): LiveSnapshot => ({
  streamId: "s-1",
  title,
  category: "Just Chatting",
  startedAt: "2026-09-24T17:00:00.000Z",
  viewers,
});

describe("pollStreamsOnce", () => {
  test("records a live stream, its peak and a sample per poll, and stamps the chat log", async () => {
    await pollStreamsOnce({ fetchLive: liveOn(snapshot(5)), now: () => "2026-09-24T17:02:00.000Z" });
    await pollStreamsOnce({
      fetchLive: liveOn(snapshot(12, "nowy tytuł")),
      now: () => "2026-09-24T17:04:00.000Z",
    });
    await pollStreamsOnce({ fetchLive: liveOn(snapshot(8)), now: () => "2026-09-24T17:06:00.000Z" });

    const [stream] = listStreams({ platform: "kick" }, db).streams;
    expect(stream).toMatchObject({
      stream_id: "s-1",
      broadcaster_login: "alice",
      title: "siema",
      category: "Just Chatting",
      ended_at: null,
      last_seen_at: "2026-09-24T17:06:00.000Z",
      peak_viewers: 12,
      avg_viewers: 8,
    });
    expect(listViewerSamples("kick", "s-1", db).map((sample) => sample.viewers)).toEqual([5, 12, 8]);
    expect(getLiveBroadcast("kick", "alice")?.streamId).toBe("s-1");
  });

  test("ends a stream at the last time it was seen live", async () => {
    await pollStreamsOnce({ fetchLive: liveOn(snapshot(5)), now: () => "2026-09-24T17:02:00.000Z" });
    await pollStreamsOnce({ fetchLive: liveOn(null), now: () => "2026-09-24T17:04:00.000Z" });

    expect(listStreams({}, db).streams[0]?.ended_at).toBe("2026-09-24T17:02:00.000Z");
    expect(getLiveBroadcast("kick", "alice")).toBeNull();
  });

  test("does not end a stream when the lookup failed", async () => {
    await pollStreamsOnce({ fetchLive: liveOn(snapshot(5)), now: () => "2026-09-24T17:02:00.000Z" });
    await pollStreamsOnce({ fetchLive: liveOn(undefined), now: () => "2026-09-24T17:04:00.000Z" });

    expect(listStreams({}, db).streams[0]?.ended_at).toBeNull();
  });
});
