import { env } from "../config";

const RIOT_HEADERS = {
  "X-Riot-Token": env.RIOT_API_KEY,
};

export async function getPuuidByRiotId(
  gameName: string,
  tagLine: string,
): Promise<{ puuid: string; gameName: string; tagLine: string } | null> {
  const res = await fetch(
    `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    { headers: RIOT_HEADERS },
  );
  if (!res.ok) return null;
  return (await res.json()) as {
    puuid: string;
    gameName: string;
    tagLine: string;
  };
}

export async function getLatestMatchId(puuid: string): Promise<string | null> {
  const res = await fetch(
    `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=1`,
    { headers: RIOT_HEADERS },
  );

  if (!res.ok) return null;

  const data = (await res.json()) as string[];

  return data[0] ?? null;
}

export async function getMatchDetails(matchId: string): Promise<any | null> {
  const res = await fetch(
    `https://europe.api.riotgames.com/lol/match/v5/matches/${matchId}`,
    { headers: RIOT_HEADERS },
  );
  if (!res.ok) return null;
  return (await res.json()) as any;
}
