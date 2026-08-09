import { getPuuidByRiotId } from "../riot/api";
import {
  addLoLSubscription as addLoLSubscriptionRow,
  getGuildLoLSubscriptions,
  removeLoLSubscription as removeLoLSubscriptionRow,
} from "../database/repositories/lolSubscriptions";

export type AddLoLSubscriptionResult =
  | { ok: true; riotId: string; region: string }
  | { ok: false; error: string };

export async function addLoLSubscription(
  guildId: string,
  channelId: string,
  riotIdInput: string,
  region: string,
): Promise<AddLoLSubscriptionResult> {
  if (!riotIdInput.includes("#")) {
    return {
      ok: false,
      error: "Invalid Riot ID format. Please use Name#Tag format.",
    };
  }

  const [gameName, tagLine] = riotIdInput.split("#");
  if (!gameName || !tagLine) {
    return {
      ok: false,
      error:
        "Invalid Riot ID format. Please ensure there is text before and after the #.",
    };
  }

  const regionalRouting = region === "na" ? "americas" : "europe";
  const playerData = await getPuuidByRiotId(gameName, tagLine, regionalRouting);

  if (!playerData || !playerData.puuid) {
    return {
      ok: false,
      error: `Could not find player **${riotIdInput}** on ${region.toUpperCase()}.`,
    };
  }

  addLoLSubscriptionRow(
    guildId,
    channelId,
    playerData.puuid,
    riotIdInput,
    region,
  );

  return { ok: true, riotId: riotIdInput, region };
}

export type RemoveLoLSubscriptionResult =
  | { ok: true; riotId: string }
  | { ok: false; error: string };

export function removeLoLSubscription(
  guildId: string,
  puuid: string,
): RemoveLoLSubscriptionResult {
  const subs = getGuildLoLSubscriptions(guildId);
  const subToRemove = subs.find((s) => s.puuid === puuid);

  if (!subToRemove) {
    return {
      ok: false,
      error:
        "Could not find this subscription. Please use the autocomplete menu.",
    };
  }

  removeLoLSubscriptionRow(guildId, puuid);
  return { ok: true, riotId: subToRemove.riot_id };
}
