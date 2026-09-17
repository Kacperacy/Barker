import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { runMigrations } from "../migrations/index";
import {
  claimNextArchive,
  countUploadedParts,
  createArchive,
  getArchive,
  getParts,
  getPendingUploadParts,
  listArchives,
  listOpenArchives,
  markEnded,
  markPartStatus,
  recordPart,
  updateArchive,
} from "./vodArchives";

// Unlike the older repositories, this module takes the Database as an
// injectable argument (same shape as runMigrations), so these tests exercise
// the real queries rather than a copy of them kept in sync by hand.
function makeTestDb(): Database {
  const db = new Database(":memory:");
  runMigrations(db);
  return db;
}

function newArchive(db: Database, overrides: Record<string, unknown> = {}) {
  return createArchive(
    {
      platform: "twitch",
      streamerLogin: "alice",
      streamId: "stream-1",
      title: "Playing something",
      startedAt: "2026-01-01T10:00:00Z",
      ...overrides,
    } as any,
    db,
  );
}

describe("createArchive", () => {
  test("creates a pending archive and returns its id", () => {
    const db = makeTestDb();
    const id = newArchive(db);

    const archive = getArchive(id, db);
    expect(archive).toMatchObject({
      platform: "twitch",
      streamer_login: "alice",
      stream_id: "stream-1",
      title: "Playing something",
      started_at: "2026-01-01T10:00:00Z",
      status: "pending",
      ended_at: null,
      bytes: 0,
    });
  });

  // Kick re-reports the same livestream on every polling tick and Twitch can
  // redeliver an EventSub notification, so this is the common path.
  test("is idempotent — a repeated go-live returns the same id without a second row", () => {
    const db = makeTestDb();
    const first = newArchive(db);
    const second = newArchive(db);

    expect(second).toBe(first);
    expect(listArchives(100, db)).toHaveLength(1);
  });

  test("does not clobber the status of an archive already in progress", () => {
    const db = makeTestDb();
    const id = newArchive(db);
    claimNextArchive(db);

    newArchive(db);

    expect(getArchive(id, db)?.status).toBe("recording");
  });

  test("treats a later broadcast by the same streamer as a separate archive", () => {
    const db = makeTestDb();
    newArchive(db);
    newArchive(db, { streamId: "stream-2" });

    expect(listArchives(100, db)).toHaveLength(2);
  });
});

describe("claimNextArchive", () => {
  test("claims a pending archive and flips it to recording", () => {
    const db = makeTestDb();
    const id = newArchive(db);

    const claimed = claimNextArchive(db);

    expect(claimed?.id).toBe(id);
    expect(claimed?.status).toBe("recording");
  });

  // Guards against a restarting recorder starting a second capture of a
  // broadcast it is already recording.
  test("does not hand out the same archive twice", () => {
    const db = makeTestDb();
    newArchive(db);

    expect(claimNextArchive(db)).not.toBeNull();
    expect(claimNextArchive(db)).toBeNull();
  });

  test("returns null when nothing is pending", () => {
    const db = makeTestDb();
    expect(claimNextArchive(db)).toBeNull();
  });

  test("claims in go-live order", () => {
    const db = makeTestDb();
    const first = newArchive(db);
    const second = newArchive(db, { streamId: "stream-2" });

    expect(claimNextArchive(db)?.id).toBe(first);
    expect(claimNextArchive(db)?.id).toBe(second);
  });
});

describe("markEnded", () => {
  test("stamps ended_at on the open broadcast for that streamer", () => {
    const db = makeTestDb();
    const id = newArchive(db);
    claimNextArchive(db);

    const ended = markEnded("twitch", "alice", db);

    expect(ended?.id).toBe(id);
    expect(getArchive(id, db)?.ended_at).not.toBeNull();
  });

  // Twitch's stream.offline payload has no stream id, so this has to resolve
  // the target by streamer — and must pick the current broadcast, not an old one.
  test("ends the most recent open broadcast, leaving finished ones untouched", () => {
    const db = makeTestDb();
    const old = newArchive(db);
    updateArchive(old, { status: "done" }, db);
    const current = newArchive(db, { streamId: "stream-2" });

    expect(markEnded("twitch", "alice", db)?.id).toBe(current);
    expect(getArchive(old, db)?.ended_at).toBeNull();
  });

  test("ends a pending archive too, so a stream the recorder never picked up is still closed", () => {
    const db = makeTestDb();
    const id = newArchive(db);

    expect(markEnded("twitch", "alice", db)?.id).toBe(id);
  });

  test("returns null when the streamer has no open broadcast", () => {
    const db = makeTestDb();
    expect(markEnded("twitch", "nobody", db)).toBeNull();
  });

  test("does not cross platforms", () => {
    const db = makeTestDb();
    newArchive(db);
    expect(markEnded("kick", "alice", db)).toBeNull();
  });

  test("keeps the original end time when the offline signal repeats", () => {
    const db = makeTestDb();
    newArchive(db);

    const first = markEnded("twitch", "alice", db)?.ended_at;
    const second = markEnded("twitch", "alice", db)?.ended_at;

    expect(second).toBe(first!);
  });
});

describe("updateArchive", () => {
  test("applies a partial patch without touching other columns", () => {
    const db = makeTestDb();
    const id = newArchive(db);

    updateArchive(id, { status: "failed", error: "streamlink exited 1" }, db);

    expect(getArchive(id, db)).toMatchObject({
      status: "failed",
      error: "streamlink exited 1",
      title: "Playing something",
    });
  });

  test("is a no-op for an empty patch", () => {
    const db = makeTestDb();
    const id = newArchive(db);

    expect(() => updateArchive(id, {}, db)).not.toThrow();
    expect(getArchive(id, db)?.status).toBe("pending");
  });
});

describe("parts", () => {
  test("records a segment as awaiting upload", () => {
    const db = makeTestDb();
    const id = newArchive(db);

    recordPart(id, 0, "/data/part_000.mp4", 1234, db);

    expect(getParts(id, db)).toMatchObject([
      { part_index: 0, local_path: "/data/part_000.mp4", bytes: 1234, status: "recorded" },
    ]);
  });

  test("re-recording the same index updates it rather than duplicating", () => {
    const db = makeTestDb();
    const id = newArchive(db);

    recordPart(id, 0, "/data/part_000.mp4", 100, db);
    recordPart(id, 0, "/data/part_000.mp4", 500, db);

    expect(getParts(id, db)).toHaveLength(1);
    expect(getParts(id, db)[0]?.bytes).toBe(500);
  });

  test("marking a part uploaded stores its remote path and clears the error", () => {
    const db = makeTestDb();
    const id = newArchive(db);
    recordPart(id, 0, "/data/part_000.mp4", 100, db);
    markPartStatus(id, 0, "failed", { error: "network" }, db);

    markPartStatus(id, 0, "uploaded", { remotePath: "gdrive:x/part_000.mp4" }, db);

    expect(getParts(id, db)[0]).toMatchObject({
      status: "uploaded",
      remote_path: "gdrive:x/part_000.mp4",
      error: null,
    });
  });

  // This set is what the uploader drains on startup; getting it wrong either
  // leaks disk space or re-sends parts that already cost bandwidth.
  test("pending uploads cover recorded, in-flight and failed parts but not uploaded ones", () => {
    const db = makeTestDb();
    const id = newArchive(db);
    for (const index of [0, 1, 2, 3]) {
      recordPart(id, index, `/data/part_00${index}.mp4`, 10, db);
    }
    markPartStatus(id, 0, "uploaded", { remotePath: "r/0" }, db);
    markPartStatus(id, 1, "uploading", {}, db);
    markPartStatus(id, 2, "failed", { error: "boom" }, db);

    expect(getPendingUploadParts(id, db).map((p) => p.part_index)).toEqual([
      1, 2, 3,
    ]);
    expect(countUploadedParts(id, db)).toBe(1);
  });

  test("parts are scoped to their own archive", () => {
    const db = makeTestDb();
    const first = newArchive(db);
    const second = newArchive(db, { streamId: "stream-2" });
    recordPart(first, 0, "/data/a.mp4", 1, db);
    recordPart(second, 0, "/data/b.mp4", 1, db);

    expect(getParts(first, db)).toHaveLength(1);
    expect(getParts(first, db)[0]?.local_path).toBe("/data/a.mp4");
  });
});

describe("listing", () => {
  test("listArchives returns newest broadcasts first", () => {
    const db = makeTestDb();
    newArchive(db, { streamId: "old", startedAt: "2026-01-01T00:00:00Z" });
    newArchive(db, { streamId: "new", startedAt: "2026-02-01T00:00:00Z" });

    expect(listArchives(100, db).map((a) => a.stream_id)).toEqual([
      "new",
      "old",
    ]);
  });

  test("listOpenArchives excludes finished and failed broadcasts", () => {
    const db = makeTestDb();
    const open = newArchive(db);
    const done = newArchive(db, { streamId: "s2" });
    const failed = newArchive(db, { streamId: "s3" });
    updateArchive(done, { status: "done" }, db);
    updateArchive(failed, { status: "failed" }, db);

    expect(listOpenArchives(db).map((a) => a.id)).toEqual([open]);
  });
});
