import { EmbedBuilder } from "discord.js";
import { isRemake } from "../riot/rank";

const TWITCH_AUTHOR_ICON_URL =
  "https://cdn-icons-png.flaticon.com/512/5968/5968819.png";

export function buildLiveEmbed(stream: any): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x9146ff)
    .setTitle(stream.title)
    .setURL(`https://twitch.tv/${stream.user_login}`)
    .setAuthor({
      name: `${stream.user_name} is live in ${stream.game_name || "a category"}!`,
      iconURL: TWITCH_AUTHOR_ICON_URL,
    })
    .addFields(
      {
        name: "Language",
        value: stream.language ? stream.language.toUpperCase() : "N/A",
        inline: true,
      },
      { name: "Viewers", value: stream.viewer_count.toString(), inline: true },
    )
    .setImage(
      stream.thumbnail_url
        .replace("{width}", "1280")
        .replace("{height}", "720"),
    )
    .setTimestamp();
}

export function buildOfflineEmbed(
  broadcasterName: string,
  login: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x808080)
    .setAuthor({
      name: `${broadcasterName} was live`,
      iconURL: TWITCH_AUTHOR_ICON_URL,
    })
    .setTitle("Stream has ended")
    .setURL(`https://twitch.tv/${login}`)
    .setDescription("Catch them next time!")
    .setTimestamp();
}

export function buildLoLLiveEmbed(
  matchData: any,
  puuid: string,
  riotId: string,
  regionOpgg: string,
  rankText: string,
  lpChangeText: string,
  streak: string,
): EmbedBuilder {
  const participant = matchData.info.participants.find(
    (p: any) => p.puuid === puuid,
  );

  const remake = isRemake(
    matchData.info.gameDuration,
    participant.gameEndedInEarlySurrender,
  );
  const shouldMarkAsVictory = participant.win;

  let embedColor = shouldMarkAsVictory ? 0x00ff00 : 0xff0000;
  let resultTitle = shouldMarkAsVictory ? "Victory" : "Defeat";

  if (remake) {
    embedColor = 0x808080;
    resultTitle = "Remake";
  }

  const durationSeconds = matchData.info.gameDuration;
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  const durationStr = `${minutes}m ${seconds}s`;

  const farm =
    (participant.totalMinionsKilled || 0) +
    (participant.neutralMinionsKilled || 0);
  const csPerMin = (farm / (durationSeconds / 60)).toFixed(1);

  const [name = "", tag = ""] = riotId.split("#");
  const opggLink = `https://www.op.gg/summoners/${regionOpgg}/${encodeURIComponent(name)}-${encodeURIComponent(tag)}`;

  const rawMatchId = matchData.metadata.matchId.split("_")[1];
  const matchLink = `https://www.leagueofgraphs.com/match/${regionOpgg}/${rawMatchId}`;

  const currentRankDisplay = rankText
    ? `${rankText}${lpChangeText}`
    : "Unranked";

  const championIconUrl = `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${participant.championId}.png`;

  return new EmbedBuilder()
    .setColor(embedColor)
    .setAuthor({
      name: `${riotId} finished a match!`,
      url: opggLink,
    })
    .setTitle(`${resultTitle} with ${participant.championName}`)
    .setURL(matchLink)
    .addFields(
      { name: "Role", value: participant.teamPosition || "N/A", inline: true },
      {
        name: "KDA",
        value: `${participant.kills}/${participant.deaths}/${participant.assists}`,
        inline: true,
      },
      {
        name: "Vision",
        value: participant.visionScore.toString(),
        inline: true,
      },
      { name: "CS (Farm)", value: `${farm} (${csPerMin} / min)`, inline: true },
      { name: "Duration", value: durationStr, inline: true },
      { name: "Current Rank", value: currentRankDisplay, inline: true },
      { name: "Current Streak", value: streak, inline: true },
    )
    .setThumbnail(championIconUrl)
    .setTimestamp();
}

export function formatNotificationText(
  template: string,
  streamerName: string,
  gameName: string,
): string {
  return template
    .replace(/{streamer}/gi, streamerName)
    .replace(/{game}/gi, gameName || "a category");
}
