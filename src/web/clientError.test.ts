import { describe, expect, test } from "bun:test";
import { handleApiRequest, logClientError } from "./server";
import { RateLimiter } from "./rateLimit";

describe("POST /client-error", () => {
  test("logs one line per distinct error an hour, trimmed", () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    const report = JSON.stringify({
      kind: "error",
      message: "Cannot read properties of null (reading 'x')\n  and more",
      stack: "TypeError: boom\n    at render (https://www.klaun.live/assets/index-abc.js:1:200)\n    at x",
      path: "/vod/tlvven",
      release: "abc1234",
      userAgent: "ignored",
    });
    expect(logClientError(report, 1_000, log)).toBe(true);
    expect(logClientError(report, 2_000, log)).toBe(false);
    expect(logClientError(report, 1_000 + 3_600_001, log)).toBe(true);
    expect(lines[0]).toBe(
      "[client error] Cannot read properties of null (reading 'x') and more @ /vod/tlvven (abc1234) at render (https://www.klaun.live/assets/index-abc.js:1:200)",
    );
    expect(lines).toHaveLength(2);
  });

  test("ignores junk", () => {
    const log = () => {
      throw new Error("should not log");
    };
    for (const body of ["", "nope", "[]", "{}", JSON.stringify({ message: 42 })]) {
      expect(logClientError(body, 0, log)).toBe(false);
    }
  });

  test("answers 204, POST only, and is throttled like reports", async () => {
    const limiter = new RateLimiter();
    const post = () =>
      handleApiRequest(
        new Request("http://x/client-error", {
          method: "POST",
          body: JSON.stringify({ message: `m${Math.random()}`, path: "/" }),
          headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
        }),
        { limiter },
      );
    expect((await post()).status).toBe(204);
    expect((await handleApiRequest(new Request("http://x/client-error"), { limiter })).status).toBe(405);
    let last = 204;
    for (let i = 0; i < 12; i++) last = (await post()).status;
    expect(last).toBe(429);
  });
});
