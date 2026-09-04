import { describe, expect, test } from "bun:test";
import { formatBytes, formatDuration, renderPage, type ArchiveView } from "./web";

function view(overrides: Partial<ArchiveView> = {}): ArchiveView {
  return {
    id: 1,
    platform: "twitch",
    streamer_login: "alice",
    stream_id: "s1",
    title: "Just chatting",
    started_at: "2026-01-15T22:30:00Z",
    ended_at: "2026-01-16T02:00:00Z",
    status: "done",
    error: null,
    live_m3u8: null,
    vod_m3u8: null,
    drive_folder: "gdrive:VODs/twitch/alice/2026-01-15_s1",
    bytes: 5_368_709_120,
    updated_at: "2026-01-16T02:05:00Z",
    uploaded_parts: 4,
    total_parts: 4,
    ...overrides,
  };
}

describe("formatBytes", () => {
  test("scales into human units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5_368_709_120)).toBe("5.0 GB");
  });

  test("shows a dash rather than 0 B for an archive with nothing uploaded", () => {
    expect(formatBytes(0)).toBe("—");
  });
});

describe("formatDuration", () => {
  test("formats hours and minutes", () => {
    expect(formatDuration("2026-01-15T22:30:00Z", "2026-01-16T02:00:00Z")).toBe(
      "3h 30m",
    );
  });

  test("formats a sub-hour broadcast", () => {
    expect(formatDuration("2026-01-15T22:30:00Z", "2026-01-15T22:52:00Z")).toBe(
      "22m",
    );
  });

  // A stream still running has no end time; the page should show elapsed time
  // rather than a blank cell.
  test("measures an in-progress broadcast against now", () => {
    const startedAt = new Date(Date.now() - 90 * 60_000).toISOString();
    expect(formatDuration(startedAt, null)).toBe("1h 30m");
  });

  test("does not produce nonsense from unparseable timestamps", () => {
    expect(formatDuration("not a date", null)).toBe("—");
  });
});

describe("renderPage", () => {
  test("renders a row per broadcast", () => {
    const html = renderPage([view(), view({ id: 2, streamer_login: "bob" })]);
    expect(html).toContain("alice");
    expect(html).toContain("bob");
    expect(html).toContain("2 broadcasts tracked");
  });

  test("shows upload progress while a broadcast is still being archived", () => {
    const html = renderPage([
      view({ status: "uploading", uploaded_parts: 2, total_parts: 5 }),
    ]);
    expect(html).toContain("2/5");
    expect(html).toContain('class="status uploading"');
  });

  test("says so plainly when nothing has been archived", () => {
    expect(renderPage([])).toContain("Nothing archived yet");
  });

  // Stream titles are broadcaster-controlled, so they must never reach the
  // page as markup.
  test("escapes broadcaster-controlled text", () => {
    const html = renderPage([
      view({ title: '<img src=x onerror="alert(1)">' }),
    ]);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  test("handles a broadcast with no title", () => {
    expect(() => renderPage([view({ title: null })])).not.toThrow();
  });
});
