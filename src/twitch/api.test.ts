import { describe, expect, test } from "bun:test";
import { isZombieSubscription, planConflictResolution } from "./api";

const sub = (status: string, sessionId?: string) => ({
  id: "sub-1",
  type: "stream.online",
  status,
  condition: { broadcaster_user_id: "123" },
  transport: { method: "websocket", session_id: sessionId },
});

describe("isZombieSubscription", () => {
  test("keeps subscriptions Twitch still considers enabled", () => {
    expect(isZombieSubscription(sub("enabled"))).toBe(false);
  });

  test("reaps every dead-websocket status, not just websocket_disconnected", () => {
    const deadStatuses = [
      "websocket_disconnected",
      "websocket_network_timeout",
      "websocket_network_error",
      "websocket_failed_ping_pong",
      "websocket_connection_unused",
      "websocket_internal_error",
      "user_removed",
    ];

    for (const status of deadStatuses) {
      expect(isZombieSubscription(sub(status))).toBe(true);
    }
  });
});

describe("planConflictResolution", () => {
  test("keeps an existing subscription that is live on the current session", () => {
    expect(planConflictResolution(sub("enabled", "sess-1"), "sess-1")).toBe(
      "keep",
    );
  });

  test("replaces a subscription bound to a session that is gone", () => {
    expect(planConflictResolution(sub("enabled", "old-sess"), "sess-1")).toBe(
      "replace",
    );
    expect(
      planConflictResolution(sub("websocket_network_timeout", "old-sess"), "sess-1"),
    ).toBe("replace");
  });

  test("retries creation when the conflicting subscription can't be found", () => {
    expect(planConflictResolution(null, "sess-1")).toBe("create");
  });
});
