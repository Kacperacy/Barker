import { describe, expect, test } from "bun:test";
import { getQueuedChannelCount, queueDiscordAction } from "./queue";

describe("queueDiscordAction", () => {
  test("runs actions for the same channel in order", async () => {
    const order: number[] = [];
    const channelId = `chan-${Math.random()}`;

    const p1 = queueDiscordAction(channelId, async () => {
      order.push(1);
    });
    const p2 = queueDiscordAction(channelId, async () => {
      order.push(2);
    });
    const p3 = queueDiscordAction(channelId, async () => {
      order.push(3);
    });

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  test("evicts the channel entry once its queue drains (no unbounded growth)", async () => {
    const channelIds = Array.from(
      { length: 1000 },
      (_, i) => `load-test-chan-${i}`,
    );

    await Promise.all(
      channelIds.map((id) => queueDiscordAction(id, async () => "done")),
    );

    // The DELAY_MS pause happens in the `finally` before the promise settles,
    // and eviction is chained on that same settlement, so awaiting all the
    // returned promises above is sufficient — no extra wait needed here.
    expect(getQueuedChannelCount()).toBe(0);
  });

  test("a failing action does not break the channel's queue or leak the entry", async () => {
    const channelId = `chan-fail-${Math.random()}`;

    const result = await queueDiscordAction(channelId, async () => {
      throw new Error("boom");
    });

    expect(result).toBeNull();
    expect(getQueuedChannelCount()).toBe(0);
  });
});
