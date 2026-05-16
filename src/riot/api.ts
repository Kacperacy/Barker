import { env } from "../config";
import { logger } from "../utils/logger";

const RIOT_HEADERS = {
  "X-Riot-Token": env.RIOT_API_KEY,
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Charset": "application/x-www-form-urlencoded; charset=UTF-8",
};

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
  const res = await fetch(
    `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    { headers: RIOT_HEADERS },
  );
  if (!res.ok) {
    logger.error(
      `[Riot API] getPuuidByRiotId error: ${res.status} ${await res.text()}`,
    );
    return null;
  }
  return (await res.json()) as {
    puuid: string;
    gameName: string;
    tagLine: string;
  };
}

export async function getLatestMatchId(
  puuid: string,
  regional: string,
): Promise<string | null> {
  const res = await fetch(
    `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=0&count=1`,
    { headers: RIOT_HEADERS },
  );
  if (!res.ok) {
    logger.error(
      `[Riot API] getLatestMatchId error: ${res.status} ${await res.text()}`,
    );
    return null;
  }
  const data = (await res.json()) as string[];
  return data[0] ?? null;
}

export async function getMatchDetails(
  matchId: string,
  regional: string,
): Promise<any | null> {
  const res = await fetch(
    `https://${regional}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
    { headers: RIOT_HEADERS },
  );
  if (!res.ok) {
    logger.error(
      `[Riot API] getMatchDetails error: ${res.status} ${await res.text()}`,
    );
    return null;
  }
  return (await res.json()) as any;
}

export async function getLeagueData(
  puuid: string,
  platform: string,
): Promise<any[] | null> {
  // UWAGA: Nowy autoryzowany endpoint wg dokumentacji, którą wkleiłeś:
  const res = await fetch(
    `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`,
    { headers: RIOT_HEADERS },
  );
  if (!res.ok) {
    logger.error(
      `[Riot API] getLeagueData error for PUUID ${puuid}: ${res.status} ${await res.text()}`,
    );
    return null;
  }
  return (await res.json()) as any[];
}
