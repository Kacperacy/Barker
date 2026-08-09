import { env } from "../config";
import { logger } from "../utils/logger";
import { fetchWithRetry, RateLimiter } from "../utils/http";
import {
  accountDtoSchema,
  leagueEntriesSchema,
  matchDtoSchema,
  matchIdsSchema,
} from "./schemas";

const RIOT_HEADERS = {
  "X-Riot-Token": env.RIOT_API_KEY,
};

const riotRateLimiter = new RateLimiter([
  { maxRequests: env.RIOT_RATE_LIMIT_PER_SECOND, windowMs: 1000 },
  { maxRequests: env.RIOT_RATE_LIMIT_PER_TWO_MINUTES, windowMs: 120000 },
]);

async function riotFetch(url: string): Promise<Response> {
  return fetchWithRetry(
    url,
    { headers: RIOT_HEADERS },
    {
      retries: env.HTTP_RETRY_MAX_ATTEMPTS,
      baseDelayMs: env.HTTP_RETRY_BASE_DELAY_MS,
      rateLimiter: riotRateLimiter,
    },
  );
}

export const REGIONS: Record<
  string,
  { platform: string; regional: string; opgg: string }
> = {
  eune: { platform: "eun1", regional: "europe", opgg: "eune" },
  euw: { platform: "euw1", regional: "europe", opgg: "euw" },
  na: { platform: "na1", regional: "americas", opgg: "na" },
};

export async function getPuuidByRiotId(
  gameName: string,
  tagLine: string,
  regional: string,
): Promise<{ puuid: string; gameName: string; tagLine: string } | null> {
  const res = await riotFetch(
    `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
  );
  if (!res.ok) {
    logger.error(
      `[Riot API] getPuuidByRiotId error: ${res.status} ${await res.text()}`,
    );
    return null;
  }

  const parsed = accountDtoSchema.safeParse(await res.json());
  if (!parsed.success) {
    logger.error(
      `[Riot API] getPuuidByRiotId: unexpected response shape: ${parsed.error.message}`,
    );
    return null;
  }
  return parsed.data;
}

export async function getLatestMatchId(
  puuid: string,
  regional: string,
): Promise<string | null> {
  const res = await riotFetch(
    `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=0&count=1`,
  );
  if (!res.ok) {
    logger.error(
      `[Riot API] getLatestMatchId error: ${res.status} ${await res.text()}`,
    );
    return null;
  }

  const parsed = matchIdsSchema.safeParse(await res.json());
  if (!parsed.success) {
    logger.error(
      `[Riot API] getLatestMatchId: unexpected response shape: ${parsed.error.message}`,
    );
    return null;
  }
  return parsed.data[0] ?? null;
}

export async function getMatchDetails(
  matchId: string,
  regional: string,
): Promise<any | null> {
  const res = await riotFetch(
    `https://${regional}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
  );
  if (!res.ok) {
    logger.error(
      `[Riot API] getMatchDetails error: ${res.status} ${await res.text()}`,
    );
    return null;
  }

  const parsed = matchDtoSchema.safeParse(await res.json());
  if (!parsed.success) {
    logger.error(
      `[Riot API] getMatchDetails: unexpected response shape: ${parsed.error.message}`,
    );
    return null;
  }
  return parsed.data;
}

export async function getLeagueData(
  puuid: string,
  platform: string,
): Promise<any[] | null> {
  const res = await riotFetch(
    `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`,
  );
  if (!res.ok) {
    logger.error(
      `[Riot API] getLeagueData error for PUUID ${puuid}: ${res.status} ${await res.text()}`,
    );
    return null;
  }

  const parsed = leagueEntriesSchema.safeParse(await res.json());
  if (!parsed.success) {
    logger.error(
      `[Riot API] getLeagueData: unexpected response shape: ${parsed.error.message}`,
    );
    return null;
  }
  return parsed.data;
}
