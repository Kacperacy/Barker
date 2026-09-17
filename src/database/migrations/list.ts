import migration0001 from "./0001_initial";
import migration0002 from "./0002_lol_player_matches_lp_change";
import migration0003 from "./0003_unify_live_tracking";
import migration0004 from "./0004_add_platform_support";
import migration0006 from "./0006_chat_logging";
import type { Migration } from "./types";

// 0005 is skipped on purpose: it belongs to the VOD-archiving branch. Migration
// versions are global — renumbering this one to fill the gap would make two
// different migrations claim version 5, and the runner would then silently apply
// only whichever landed first.
export const migrations: Migration[] = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0006,
].sort((a, b) => a.version - b.version);
