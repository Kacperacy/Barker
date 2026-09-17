import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../database/migrations/index";
import {
  createArchive,
  getArchive,
  getParts,
} from "../database/repositories/vodArchives";
import { buildRcloneArgs, drainClosedParts } from "./uploader";

function makeTestDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

function setup(segments: string[]) {
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

  const uploaded: Array<{ local: string; remote: string }> = [];
  const removed: string[] = [];
  const present = new Set(segments);

  const deps = {
    db,
    listSegments: async () => [...present],
    statSize: async () => 1000,
    upload: async (local: string, remote: string) => {
      uploaded.push({ local, remote });
    },
    remove: async (path: string) => {
      removed.push(path);
      present.delete(path.split("/").pop()!);
    },
  };

  return { db, archiveId, deps, uploaded, removed };
}

const DIR = "/data/rec/1";
const REMOTE = "gdrive:VODs/twitch/alice/2026-01-15_s1";

describe("drainClosedParts", () => {
  test("uploads closed segments and leaves the one still being written", async () => {
    const { deps, archiveId, uploaded } = setup([
      "part_00000.mp4",
      "part_00001.mp4",
      "part_00002.mp4",
    ]);

    const result = await drainClosedParts(
      archiveId,
      DIR,
      REMOTE,
      false,
      deps,
    );

    expect(result.uploaded).toEqual([0, 1]);
    expect(uploaded.map((u) => u.remote)).toEqual([
      `${REMOTE}/part_00000.mp4`,
      `${REMOTE}/part_00001.mp4`,
    ]);
  });

  // This is the whole point of segmenting: a multi-hour broadcast must never
  // occupy more than a segment or two of disk at a time.
  test("deletes each segment locally once it is safely uploaded", async () => {
    const { deps, archiveId, removed } = setup([
      "part_00000.mp4",
      "part_00001.mp4",
    ]);

    await drainClosedParts(archiveId, DIR, REMOTE, false, deps);

    expect(removed).toEqual([`${DIR}/part_00000.mp4`]);
  });

  test("does not delete a segment whose upload failed", async () => {
    const { deps, archiveId, removed, db } = setup([
      "part_00000.mp4",
      "part_00001.mp4",
    ]);
    deps.upload = async () => {
      throw new Error("network down");
    };

    const result = await drainClosedParts(archiveId, DIR, REMOTE, false, deps);

    expect(result.failed).toEqual([0]);
    expect(removed).toEqual([]);
    expect(getParts(archiveId, db)[0]).toMatchObject({
      status: "failed",
      error: "network down",
    });
  });

  test("retries a previously failed segment on the next drain", async () => {
    const { deps, archiveId, uploaded } = setup([
      "part_00000.mp4",
      "part_00001.mp4",
    ]);
    let attempt = 0;
    const realUpload = deps.upload;
    deps.upload = async (local: string, remote: string) => {
      if (attempt++ === 0) throw new Error("transient");
      return realUpload(local, remote);
    };

    await drainClosedParts(archiveId, DIR, REMOTE, false, deps);
    const second = await drainClosedParts(archiveId, DIR, REMOTE, false, deps);

    expect(second.uploaded).toEqual([0]);
    expect(uploaded).toHaveLength(1);
  });

  // Re-sending a part that already cost bandwidth is the expensive mistake
  // here, so an already-uploaded index must never be picked up twice.
  test("never re-uploads a segment that already succeeded", async () => {
    const { deps, archiveId, uploaded } = setup([
      "part_00000.mp4",
      "part_00001.mp4",
    ]);

    await drainClosedParts(archiveId, DIR, REMOTE, false, deps);
    await drainClosedParts(archiveId, DIR, REMOTE, false, deps);

    expect(uploaded).toHaveLength(1);
  });

  test("includes the final segment once the capture has finished", async () => {
    const { deps, archiveId } = setup(["part_00000.mp4", "part_00001.mp4"]);

    const result = await drainClosedParts(archiveId, DIR, REMOTE, true, deps);

    expect(result.uploaded).toEqual([0, 1]);
  });

  test("accumulates uploaded bytes on the archive", async () => {
    const { deps, archiveId, db } = setup([
      "part_00000.mp4",
      "part_00001.mp4",
      "part_00002.mp4",
    ]);

    await drainClosedParts(archiveId, DIR, REMOTE, false, deps);

    expect(getArchive(archiveId, db)?.bytes).toBe(2000);
  });

  test("does nothing when there are no segments yet", async () => {
    const { deps, archiveId, uploaded } = setup([]);

    const result = await drainClosedParts(archiveId, DIR, REMOTE, false, deps);

    expect(result).toEqual({ uploaded: [], failed: [] });
    expect(uploaded).toEqual([]);
  });
});

describe("buildRcloneArgs", () => {
  test("copies a single file to an exact remote path", () => {
    const args = buildRcloneArgs("/data/part_00000.mp4", "gdrive:x/p.mp4", "/c/rclone.conf");
    expect(args[0]).toBe("copyto");
    expect(args.slice(1, 3)).toEqual(["/data/part_00000.mp4", "gdrive:x/p.mp4"]);
  });

  test("points rclone at the mounted config", () => {
    const args = buildRcloneArgs("/a", "b:c", "/config/rclone/rclone.conf");
    expect(args[args.indexOf("--config") + 1]).toBe(
      "/config/rclone/rclone.conf",
    );
  });

  test("retries inside rclone as well, so a blip does not fail the part", () => {
    const args = buildRcloneArgs("/a", "b:c", "/conf");
    expect(args).toContain("--retries");
  });
});
