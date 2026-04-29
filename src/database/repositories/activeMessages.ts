import { db } from "../connection";

export const saveActiveMessage = (
  streamerName: string,
  channelId: string,
  messageId: string,
) => {
  db.query(
    `INSERT OR REPLACE INTO active_messages (streamer_name, channel_id, message_id) VALUES (?1, ?2, ?3)`,
  ).run(streamerName.toLowerCase(), channelId, messageId);
};

export const getActiveMessages = (
  streamerName: string,
): { channel_id: string; message_id: string }[] => {
  return db
    .query(
      "SELECT channel_id, message_id FROM active_messages WHERE streamer_name = ?1",
    )
    .all(streamerName.toLowerCase()) as {
    channel_id: string;
    message_id: string;
  }[];
};

export const clearActiveMessages = (streamerName: string) => {
  db.query("DELETE FROM active_messages WHERE streamer_name = ?1").run(
    streamerName.toLowerCase(),
  );
};
