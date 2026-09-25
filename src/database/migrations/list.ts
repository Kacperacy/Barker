import migration0001 from "./0001_initial";
import migration0002 from "./0002_lol_player_matches_lp_change";
import migration0003 from "./0003_unify_live_tracking";
import migration0004 from "./0004_add_platform_support";
import migration0006 from "./0006_chat_logging";
import migration0007 from "./0007_streamrecorder_vods";
import migration0008 from "./0008_streamrecorder_vods_keys";
import migration0009 from "./0009_chat_log_cleanup";
import migration0010 from "./0010_drop_streamrecorder_vods";
import migration0011 from "./0011_moderation_target_message";
import migration0012 from "./0012_stream_history";
import migration0013 from "./0013_accounts_highlights";
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
  migration0008,
  migration0009,
  migration0010,
  migration0011,
  migration0012,
  migration0013,
].sort((a, b) => a.version - b.version);

