import { Client, TextChannel, EmbedBuilder } from "discord.js";
import { logger } from "../utils/logger";
import { queueDiscordAction } from "../utils/queue";

export function buildLiveEmbed(stream: any): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x9146ff)
    .setTitle(stream.title)
    .setURL(`https://twitch.tv/${stream.user_login}`)
    .setAuthor({
      name: `${stream.user_name} is live in ${stream.game_name || "a category"}!`,
      iconURL: "https://cdn-icons-png.flaticon.com/512/5968/5968819.png",
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
      iconURL: "https://cdn-icons-png.flaticon.com/512/5968/5968819.png",
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
): EmbedBuilder {
  const participant = matchData.info.participants.find(
    (p: any) => p.puuid === puuid,
  );
  const shouldMarkAsVictory = participant.win;
  const embedColor = shouldMarkAsVictory ? 0x00ff00 : 0xff0000;
  const resultTitle = shouldMarkAsVictory ? "Victory" : "Defeat";

  // Duration
  const durationSeconds = matchData.info.gameDuration;
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  const durationStr = `${minutes}m ${seconds}s`;

  // Farm
  const farm =
    (participant.totalMinionsKilled || 0) +
    (participant.neutralMinionsKilled || 0);
  const csPerMin = (farm / (durationSeconds / 60)).toFixed(1);

  const [name = "", tag = ""] = riotId.split("#");
  const opggLink = `https://www.op.gg/summoners/${regionOpgg}/${encodeURIComponent(name)}-${encodeURIComponent(tag)}`;

  const rawMatchId = matchData.metadata.matchId.split("_")[1];
  const matchLink = `https://www.leagueofgraphs.com/match/${regionOpgg}/${rawMatchId}`;

  // Rank Display
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

export async function sendStreamNotification(
  client: Client,
  channelId: string,
  stream: any,
  customMessage: string | null | undefined,
  defaultTemplate: string,
): Promise<string | null> {
  return queueDiscordAction(channelId, async () => {
    try {
      const channel = (await client.channels.fetch(channelId)) as TextChannel;
      if (!channel) return null;

      const templateToUse = customMessage || defaultTemplate;
      const textContent = formatNotificationText(
        templateToUse,
        stream.user_name,
        stream.game_name,
      );
      const embed = buildLiveEmbed(stream);

      const sentMessage = await channel.send({
        content: textContent,
        embeds: [embed],
      });
      return sentMessage.id;
    } catch (err) {
      logger.error(`Could not send message to channel ${channelId}:`, err);
      return null;
    }
  });
}

export async function editMessageToOffline(
  client: Client,
  channelId: string,
  messageId: string,
  broadcasterName: string,
  login: string,
): Promise<void> {
  await queueDiscordAction(channelId, async () => {
    try {
      const channel = (await client.channels.fetch(channelId)) as TextChannel;
      if (!channel) return;

      const messageToEdit = await channel.messages.fetch(messageId);
      if (!messageToEdit) return;

      const embedOffline = buildOfflineEmbed(broadcasterName, login);

      await messageToEdit.edit({
        content: `~~${broadcasterName}~~ (Offline)`,
        embeds: [embedOffline],
      });
    } catch (err) {
      logger.error(
        `Could not edit offline message in channel ${channelId}:`,
        err,
      );
    }
  });
}
