import { beforeEach, describe, expect, test } from "bun:test";
import { runMigrations } from "../database/migrations/index";
import { db } from "../database/connection";
import { listRecordings } from "../database/repositories/recordings";
import { fromKick, kickTime, syncRecordingsOnce, twitchDuration } from "./sync";

// test/setup.ts logs twitch:alice and kick:alice.
runMigrations();

beforeEach(() => {
  db.query("DELETE FROM recordings").run();
});

// Trimmed from kick.com/api/v2/channels/<slug>/videos.
const kickVideo = (id: number, start: string, extra: Record<string, unknown> = {}) => ({
  id,
  slug: "x",
  start_time: start,
  duration: 15_185_000,
  source: `https://stream.kick.com/${id}/master.m3u8`,
  session_title: "co się dzieje na internetach?",
  views: 60,
  thumbnail: { src: `https://images.kick.com/${id}/720.webp` },
  categories: [{ name: "Just Chatting" }],
  ...extra,
});

const kickFetch = (list: unknown[] | null) =>
  (async () =>
    list === null ? new Response("nope", { status: 503 }) : new Response(JSON.stringify(list))) as unknown as typeof fetch;

describe("parsing", () => {
  test("reads Kick's unzoned times as UTC and its entries as recordings", () => {
    expect(kickTime("2026-09-24 16:57:47")).toBe("2026-09-24T16:57:47.000Z");
    expect(fromKick([kickVideo(128904405, "2026-09-24 16:57:47"), { junk: true }], "alice")).toEqual([
      {
        platform: "kick",
        videoId: "128904405",
        channelLogin: "alice",
        streamId: "128904405",
        title: "co się dzieje na internetach?",
        category: "Just Chatting",
        startedAt: "2026-09-24T16:57:47.000Z",
        durationSeconds: 15_185,
        sourceUrl: "https://stream.kick.com/128904405/master.m3u8",
        thumbnailUrl: "https://images.kick.com/128904405/720.webp",
        views: 60,
      },
    ]);
  });

  test("reads Twitch durations", () => {
    expect(twitchDuration("3h8m33s")).toBe(11_313);
    expect(twitchDuration("45m2s")).toBe(2_702);
    expect(twitchDuration("59s")).toBe(59);
    expect(twitchDuration("nonsense")).toBe(0);
  });
});

describe("syncRecordingsOnce", () => {
  const twitch = async () => [
    {
      platform: "twitch" as const,
      videoId: "2567890123",
      channelLogin: "alice",
      startedAt: "2026-09-24T17:00:00.000Z",
      durationSeconds: 3600,
    },
  ];

  test("stores both platforms, and marks what a platform stopped listing as gone", async () => {
    await syncRecordingsOnce({
      fetchImpl: kickFetch([kickVideo(1, "2026-09-23 18:00:00"), kickVideo(2, "2026-09-24 16:57:47")]),
      readTwitch: twitch,
    });
    expect(listRecordings([]).total).toBe(3);

    // Kick deleted recording 1.
    await syncRecordingsOnce({ fetchImpl: kickFetch([kickVideo(2, "2026-09-24 16:57:47")]), readTwitch: twitch });
    expect(listRecordings([]).recordings.map((row) => row.video_id).sort()).toEqual(["2", "2567890123"]);
    const all = listRecordings([], { includeGone: true }).recordings;
    expect(all.find((row) => row.video_id === "1")?.gone_at).not.toBeNull();
  });

  test("a failed read changes nothing", async () => {
    await syncRecordingsOnce({ fetchImpl: kickFetch([kickVideo(2, "2026-09-24 16:57:47")]), readTwitch: twitch });
    await syncRecordingsOnce({ fetchImpl: kickFetch(null), readTwitch: async () => null });
    expect(listRecordings([]).total).toBe(2);
  });
});
