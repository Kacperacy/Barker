import { describe, expect, test } from "bun:test";
import {
  buildVodBasePaths,
  findExistingVodUrl,
  buildVodCandidateUrls,
  buildVodPathHash,
  buildVideoUrl,
} from "./recovery";

describe("buildVodPathHash", () => {
  // Fixture computed independently (python hashlib) so this pins the
  // algorithm rather than restating the implementation.
  test("matches the known sha1-prefix scheme", () => {
    expect(buildVodPathHash("alice", "48231", 1768516200)).toBe(
      "25446d2ea54909f99974",
    );
  });

  test("changes with the timestamp", () => {
    expect(buildVodPathHash("alice", "48231", 1768516199)).toBe(
      "1aef3f5f0daee03a790b",
    );
  });

  test("is exactly twenty hex characters", () => {
    const hash = buildVodPathHash("bob", "1", 0);
    expect(hash).toHaveLength(20);
    expect(hash).toMatch(/^[0-9a-f]{20}$/);
  });
});

describe("buildVodBasePaths", () => {
  const paths = buildVodBasePaths("alice", "48231", "2026-01-15T22:30:00Z");

  // The VOD's internal start timestamp drifts from the one the API reports,
  // so probing only the reported second would essentially always miss.
  test("probes a window around the reported start time", () => {
    expect(paths).toHaveLength(91);
  });

  test("includes the exact reported second", () => {
    expect(paths).toContain("25446d2ea54909f99974_alice_48231_1768516200");
  });

  test("covers a second before the reported start", () => {
    expect(paths).toContain("1aef3f5f0daee03a790b_alice_48231_1768516199");
  });

  test("returns nothing for an unparseable start time", () => {
    expect(buildVodBasePaths("alice", "48231", "whenever")).toEqual([]);
  });
});

describe("buildVodCandidateUrls", () => {
  const urls = buildVodCandidateUrls("alice", "48231", "2026-01-15T22:30:00Z");

  test("builds fully-formed m3u8 URLs", () => {
    expect(urls[0]).toMatch(
      /^https:\/\/[a-z0-9]+\.cloudfront\.net\/[0-9a-f]{20}_alice_48231_\d+\/chunked\/index-dvr\.m3u8$/,
    );
  });

  // Source quality is what makes the archive worth having, so it is probed
  // across every domain before any lower rendition.
  test("tries source quality before lower renditions", () => {
    const firstNonChunked = urls.findIndex((u) => !u.includes("/chunked/"));
    const lastChunked = urls.findLastIndex((u) => u.includes("/chunked/"));
    expect(lastChunked).toBeLessThan(firstNonChunked);
  });

  test("spans multiple CDN domains", () => {
    const domains = new Set(urls.map((u) => new URL(u).hostname));
    expect(domains.size).toBeGreaterThan(5);
  });

  test("produces nothing when the start time cannot be parsed", () => {
    expect(buildVodCandidateUrls("alice", "48231", "nope")).toEqual([]);
  });
});

describe("findExistingVodUrl", () => {
  test("returns the first candidate that exists", async () => {
    const hit = await findExistingVodUrl(["a", "b", "c"], {
      exists: async (url) => url === "b",
    });
    expect(hit).toBe("b");
  });

  test("returns null when nothing is left on the CDN", async () => {
    expect(await findExistingVodUrl(["a", "b"], { exists: async () => false }))
      .toBeNull();
  });

  // Thousands of candidates get probed; stopping at the first hit is what
  // keeps a successful recovery fast.
  test("stops probing once a candidate hits", async () => {
    const probed: string[] = [];
    await findExistingVodUrl(["a", "b", "c", "d"], {
      concurrency: 2,
      exists: async (url) => {
        probed.push(url);
        return url === "a";
      },
    });
    expect(probed).toEqual(["a", "b"]);
  });

  test("treats a probe that throws as a miss rather than failing recovery", async () => {
    const hit = await findExistingVodUrl(["a", "b"], {
      exists: async (url) => {
        if (url === "a") throw new Error("dns");
        return true;
      },
    });
    expect(hit).toBe("b");
  });

  test("handles an empty candidate list", async () => {
    expect(await findExistingVodUrl([], { exists: async () => true })).toBeNull();
  });
});

describe("buildVideoUrl", () => {
  test("addresses a published VOD by id", () => {
    expect(buildVideoUrl("2411223344")).toBe(
      "https://twitch.tv/videos/2411223344",
    );
  });
});
