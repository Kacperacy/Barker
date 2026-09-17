import migration0001 from "./0001_initial";
import migration0002 from "./0002_lol_player_matches_lp_change";
import migration0003 from "./0003_unify_live_tracking";
import migration0004 from "./0004_add_platform_support";
import migration0006 from "./0006_chat_logging";
import migration0007 from "./0007_streamrecorder_vods";
import type { Migration } from "./types";

// 0005 is not listed and must never be: it was applied to a deployed database by
// a migration that was later removed, so the version is taken. Versions are
// global and never renumbered or reused — the runner applies whatever version is
// missing from schema_migrations, so a new migration simply takes the next free
// number.
export const migrations: Migration[] = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0006,
  migration0007,
].sort((a, b) => a.version - b.version);

