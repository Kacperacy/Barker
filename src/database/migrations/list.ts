import migration0001 from "./0001_initial";
import migration0002 from "./0002_lol_player_matches_lp_change";
import migration0003 from "./0003_unify_live_tracking";
import migration0004 from "./0004_add_platform_support";
import type { Migration } from "./types";

export const migrations: Migration[] = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
].sort((a, b) => a.version - b.version);
