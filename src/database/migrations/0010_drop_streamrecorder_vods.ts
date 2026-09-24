import type { Migration } from "./types";

// StreamRecorder support was removed: nothing reads or writes this table any
// more. 0007 and 0008 stay listed because their versions are applied on the
// deployed database; this is what takes the table away.
const migration: Migration = {
  version: 10,
  name: "drop_streamrecorder_vods",
  up(db) {
    db.query("DROP TABLE IF EXISTS streamrecorder_vods").run();
  },
};

export default migration;
