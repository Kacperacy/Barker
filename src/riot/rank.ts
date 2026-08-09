export const RANKED_SOLO_QUEUE_ID = 420;
export const REMAKE_DURATION_THRESHOLD_SECONDS = 300;

const TIER_VALUES: Record<string, number> = {
  IRON: 0,
  BRONZE: 400,
  SILVER: 800,
  GOLD: 1200,
  PLATINUM: 1600,
  EMERALD: 2000,
  DIAMOND: 2400,
  MASTER: 2800,
  GRANDMASTER: 2800,
  CHALLENGER: 2800,
};

const RANK_VALUES: Record<string, number> = {
  IV: 0,
  III: 100,
  II: 200,
  I: 300,
};

const APEX_TIERS = ["MASTER", "GRANDMASTER", "CHALLENGER"];

export function capitalizeFirst(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function getAbsoluteLp(tier: string, rank: string, lp: number): number {
  if (!tier) return 0;

  const upperTier = tier.toUpperCase();
  const base = TIER_VALUES[upperTier] || 0;

  if (APEX_TIERS.includes(upperTier)) {
    return base + lp;
  }

  const rankBase = RANK_VALUES[rank.toUpperCase()] || 0;
  return base + rankBase + lp;
}

export function isRemake(
  gameDurationSeconds: number,
  gameEndedInEarlySurrender: boolean | undefined,
): boolean {
  return (
    Boolean(gameEndedInEarlySurrender) ||
    gameDurationSeconds < REMAKE_DURATION_THRESHOLD_SECONDS
  );
}

export interface LpDiffResult {
  lpChange: number;
  lpChangeText: string;
}

export function computeLpDiff(
  oldTier: string | null | undefined,
  oldRank: string,
  oldLp: number | null | undefined,
  newTier: string,
  newRank: string,
  newLp: number,
): LpDiffResult | null {
  if (!oldTier) return null;

  const oldAbsLp = getAbsoluteLp(oldTier, oldRank, oldLp || 0);
  const newAbsLp = getAbsoluteLp(newTier, newRank, newLp);
  const lpChange = newAbsLp - oldAbsLp;

  const lpChangeText =
    lpChange > 0
      ? ` (+${lpChange})`
      : lpChange < 0
        ? ` (${lpChange})`
        : ` (+0)`;

  return { lpChange, lpChangeText };
}

export interface StreakMatch {
  win: number;
  is_remake: number;
}

export function computeStreak(matches: StreakMatch[]): string {
  let streakType: "W" | "L" | null = null;
  let count = 0;

  for (const match of matches) {
    if (match.is_remake === 1) continue;
    const currentType = match.win === 1 ? "W" : "L";

    if (streakType === null) {
      streakType = currentType;
      count = 1;
    } else if (streakType === currentType) {
      count++;
    } else {
      break;
    }
  }

  return count > 0 ? `${count}${streakType}` : "None";
}
