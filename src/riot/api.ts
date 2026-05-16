import { env } from "../config";

const RIOT_HEADERS = {
  "X-Riot-Token": env.RIOT_API_KEY,
};

// Maps simple regions to Riot's routing logic
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
  if (!res.ok) return null;
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
    `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=1`,
    { headers: RIOT_HEADERS },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as string[];
  return data[0] ?? null;
}

export async function getMatchDetails(
  matchId: string,
  regional: string,
): Promise<any | null> {
  const res = await fetch(
    `https://${regional}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
    { headers: RIOT_HEADERS },
  );
  if (!res.ok) return null;
  return (await res.json()) as any;
}

export async function getSummonerData(
  puuid: string,
  platform: string,
): Promise<{ id: string } | null> {
  const res = await fetch(
    `https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`,
    { headers: RIOT_HEADERS },
  );
  if (!res.ok) return null;
  return (await res.json()) as { id: string };
}

export async function getLeagueData(
  summonerId: string,
  platform: string,
): Promise<any[] | null> {
  const res = await fetch(
    `https://${platform}.api.riotgames.com/lol/league/v4/entries/by-summoner/${summonerId}`,
    { headers: RIOT_HEADERS },
  );
  if (!res.ok) return null;
  return (await res.json()) as any[];
}
