import { afterEach, describe, expect, test } from "bun:test";
import {
  closeEventSub,
  startEventSub,
  subscribeToStreamer,
  type WebSocketLike,
} from "./eventsub";

class FakeWebSocket implements WebSocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  close() {
    this.closed = true;
    this.onclose?.();
  }

  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const welcome = (id: string, keepaliveSeconds = 0) => ({
  metadata: { message_type: "session_welcome" },
  payload: { session: { id, keepalive_timeout_seconds: keepaliveSeconds } },
});

const keepalive = { metadata: { message_type: "session_keepalive" } };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Harness {
  sockets: FakeWebSocket[];
  calls: { login: string; eventType: string; session: string }[];
}

async function start(
  overrides: { keepaliveGraceMs?: number; initialReconnectDelayMs?: number } = {},
): Promise<Harness> {
  const harness: Harness = { sockets: [], calls: [] };

  await startEventSub({
    beforeConnect: async () => {},
    createWebSocket: () => {
      const socket = new FakeWebSocket();
      harness.sockets.push(socket);
      return socket;
    },
    subscribe: async (login, eventType, session) => {
      harness.calls.push({ login, eventType, session });
    },
    listStreamers: () => [],
    keepaliveGraceMs: overrides.keepaliveGraceMs ?? 20,
    initialReconnectDelayMs: overrides.initialReconnectDelayMs ?? 60_000,
  });

  return harness;
}

afterEach(() => closeEventSub());

describe("EventSub keepalive watchdog", () => {
  test("stops using a session that went silent without a close event", async () => {
    const { sockets, calls } = await start();
    sockets[0]!.emit(welcome("dead-session"));
    await sleep(60);

    await subscribeToStreamer("undefinedtommy");

    expect(calls).toEqual([]);
  });

  test("keeps the session alive while keepalives arrive", async () => {
    const { sockets, calls } = await start();
    const socket = sockets[0]!;
    socket.emit(welcome("live-session"));

    for (let i = 0; i < 4; i++) {
      await sleep(10);
      socket.emit(keepalive);
    }

    await subscribeToStreamer("undefinedtommy");

    expect(calls.map((c) => c.eventType)).toEqual([
      "stream.online",
      "stream.offline",
    ]);
    expect(calls.every((c) => c.session === "live-session")).toBe(true);
  });

  test("reconnects after the watchdog trips", async () => {
    const { sockets } = await start({ initialReconnectDelayMs: 10 });
    sockets[0]!.emit(welcome("dead-session"));
    await sleep(80);

    expect(sockets.length).toBeGreaterThan(1);
    expect(sockets[0]!.closed).toBe(true);
  });
});

describe("closeEventSub", () => {
  test("does not schedule a reconnect on intentional shutdown", async () => {
    const { sockets } = await start({ initialReconnectDelayMs: 10 });
    sockets[0]!.emit(welcome("live-session", 60));

    closeEventSub();
    await sleep(60);

    expect(sockets.length).toBe(1);
  });
});
