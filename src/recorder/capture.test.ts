import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../database/migrations/index";
import {
  createArchive,
  getArchive,
  markEnded,
  type VodArchive,
} from "../database/repositories/vodArchives";
import { type CaptureDeps, nextStartNumber, runArchive } from "./capture";

function makeTestDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

// A capture that writes `segmentsPerRun` files and then exits, standing in for
// streamlink|ffmpeg. `runs` lets a test make the first attempt die early.
function makeHarness(options: {
  segmentsPerRun: number[];
  freeBytes?: number;
  uploadFails?: boolean;
  // Which capture attempt the platform reports the stream offline during.
  // Defaults to the first, i.e. the ordinary "streamer ends the broadcast"
  // case. `null` means the stream never goes offline.
  offlineDuringCapture?: number | null;
}) {
  const db = makeTestDb();
  const archiveId = createArchive(
    {
      platform: "twitch",
      streamerLogin: "alice",
      streamId: "s1",
      startedAt: "2026-01-15T22:30:00Z",
    },
    db,
  );
  const archive = getArchive(archiveId, db) as VodArchive;

  const present = new Set<string>();
  const uploaded: string[] = [];
  let run = 0;
  let captureCount = 0;

  const deps: CaptureDeps = {
    db,
    startCapture: (opts) => {
      captureCount += 1;
      const offlineDuring =
        options.offlineDuringCapture === undefined
          ? 1
          : options.offlineDuringCapture;
      if (offlineDuring !== null && captureCount === offlineDuring) {
        markEnded("twitch", "alice", db);
      }
      const count = options.segmentsPerRun[run++] ?? 0;
      for (let i = 0; i < count; i++) {
        present.add(`part_${String(opts.startNumber + i).padStart(5, "0")}.mp4`);
      }
      return { exited: Promise.resolve(0), stop() {} };
    },
    uploader: {
      listSegments: async () => [...present],
      statSize: async () => 100,
      upload: async (_local, remote) => {
        if (options.uploadFails) throw new Error("no network");
        uploaded.push(remote);
      },
      remove: async (path) => {
        present.delete(path.split("/").pop()!);
      },
    },
    ensureDir: async () => {},
    listDir: async () => [...present],
    freeBytes: async () => options.freeBytes ?? 500 * 1024 ** 3,
    sleep: async () => {},
  };

  return {
    db,
    archiveId,
    archive,
    deps,
    uploaded,
    captureCount: () => captureCount,
  };
}

describe("nextStartNumber", () => {
  test("starts at zero for a fresh recording", () => {
    expect(nextStartNumber([], [])).toBe(0);
  });

  test("continues past segments still sitting on disk", () => {
    expect(nextStartNumber(["part_00000.mp4", "part_00003.mp4"], [])).toBe(4);
  });

  // Uploaded segments are deleted locally, so disk alone would restart
  // numbering at zero and overwrite them in remote storage.
  test("continues past segments already uploaded and deleted", () => {
    expect(nextStartNumber([], [0, 1, 2])).toBe(3);
  });

  test("takes the higher of the two sources", () => {
    expect(nextStartNumber(["part_00007.mp4"], [0, 1])).toBe(8);
  });

  test("ignores unrelated files", () => {
    expect(nextStartNumber(["notes.txt"], [])).toBe(0);
  });
});

describe("runArchive", () => {
  test("uploads every segment and marks the archive done", async () => {
    const h = makeHarness({ segmentsPerRun: [3] });

    await runArchive(h.archive, h.deps);

    expect(h.uploaded).toHaveLength(3);
    expect(getArchive(h.archiveId, h.db)).toMatchObject({
      status: "done",
      bytes: 300,
      error: null,
    });
  });

  test("records where the broadcast was uploaded", async () => {
    const h = makeHarness({ segmentsPerRun: [1] });

    await runArchive(h.archive, h.deps);

    expect(getArchive(h.archiveId, h.db)?.drive_folder).toBe(
      "gdrive:Barker VODs/twitch/alice/2026-01-15_s1",
    );
  });

  // Filling the host disk would take down the Discord bot and everything else
  // sharing the VPS, so this refuses rather than degrading.
  test("refuses to record when free space is below the floor", async () => {
    const h = makeHarness({ segmentsPerRun: [3], freeBytes: 1024 ** 3 });

    await runArchive(h.archive, h.deps);

    expect(h.captureCount()).toBe(0);
    expect(getArchive(h.archiveId, h.db)).toMatchObject({ status: "failed" });
    expect(getArchive(h.archiveId, h.db)?.error).toMatch(/free/);
  });

  // streamlink exits on a network blip too, and the broadcast is only really
  // over once the platform says so.
  test("restarts the capture when the stream is not yet marked offline", async () => {
    // The first capture dies mid-broadcast; the stream is only reported
    // offline during the second.
    const h = makeHarness({ segmentsPerRun: [2, 2], offlineDuringCapture: 2 });

    await runArchive(h.archive, h.deps);

    expect(h.captureCount()).toBe(2);
    expect(h.uploaded).toHaveLength(4);
  });

  test("resumes segment numbering across a restart instead of overwriting", async () => {
    const h = makeHarness({ segmentsPerRun: [2, 2], offlineDuringCapture: 2 });

    await runArchive(h.archive, h.deps);

    expect(h.uploaded.map((r) => r.split("/").pop())).toEqual([
      "part_00000.mp4",
      "part_00001.mp4",
      "part_00002.mp4",
      "part_00003.mp4",
    ]);
  });

  test("gives up instead of spinning when captures keep producing nothing", async () => {
    const h = makeHarness({ segmentsPerRun: [], offlineDuringCapture: null });

    await runArchive(h.archive, h.deps);

    expect(h.captureCount()).toBeLessThanOrEqual(5);
    expect(getArchive(h.archiveId, h.db)).toMatchObject({ status: "failed" });
  });

  test("fails the archive when nothing could be captured", async () => {
    const h = makeHarness({ segmentsPerRun: [0] });

    await runArchive(h.archive, h.deps);

    expect(getArchive(h.archiveId, h.db)?.error).toMatch(/No segments/);
  });

  // The recorder was down for the whole broadcast, so there is nothing live
  // left to capture — spawning streamlink would only fail.
  test("skips capture entirely when the broadcast is already over", async () => {
    const h = makeHarness({ segmentsPerRun: [3], offlineDuringCapture: null });
    // The bot saw both the go-live and the offline while the recorder was down.
    markEnded("twitch", "alice", h.db);

    await runArchive(h.archive, h.deps);

    expect(h.captureCount()).toBe(0);
  });

  test("stops capturing on shutdown without starting another attempt", async () => {
    const h = makeHarness({ segmentsPerRun: [1, 1], offlineDuringCapture: null });
    const controller = new AbortController();
    h.deps.signal = controller.signal;
    const inner = h.deps.startCapture;
    h.deps.startCapture = (opts) => {
      controller.abort();
      return inner(opts);
    };

    await runArchive(h.archive, h.deps);

    expect(h.captureCount()).toBe(1);
    // Whatever was captured before the shutdown is still uploaded.
    expect(h.uploaded).toHaveLength(1);
  });

  test("fails the archive when segments were captured but could not be uploaded", async () => {
    const h = makeHarness({ segmentsPerRun: [2], uploadFails: true });

    await runArchive(h.archive, h.deps);

    expect(getArchive(h.archiveId, h.db)).toMatchObject({ status: "failed" });
    expect(h.uploaded).toEqual([]);
  });
});
