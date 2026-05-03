const channelQueues = new Map<string, Promise<any>>();
const DELAY_MS = 1500;

export async function queueDiscordAction<T>(
  channelId: string,
  action: () => Promise<T>,
): Promise<T | null> {
  const currentPromise = channelQueues.get(channelId) || Promise.resolve();

  const nextPromise = currentPromise.then(async () => {
    try {
      return await action();
    } catch (error) {
      return null;
    } finally {
      await new Promise((res) => setTimeout(res, DELAY_MS));
    }
  });

  channelQueues.set(channelId, nextPromise);
  return nextPromise;
}
