import migration0001 from "./0001_initial";
import migration0002 from "./0002_lol_player_matches_lp_change";
import migration0003 from "./0003_unify_live_tracking";
import migration0004 from "./0004_add_platform_support";
import migration0005 from "./0005_vod_archives";
import migration0006 from "./0006_chat_logging";
import type { Migration } from "./types";

// Versions are global and never renumbered. 0005 arrived with VOD archiving
// after 0006 had already been applied to the deployed database; it still runs,
// because the runner walks this list and skips only the versions it finds
// recorded in schema_migrations.
export const migrations: Migration[] = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
].sort((a, b) => a.version - b.version);
