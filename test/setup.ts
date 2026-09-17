import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

// Assigned unconditionally (not `??=`) so tests are hermetic even when a
// real .env file is present locally with blank/placeholder values.
process.env.DISCORD_TOKEN = "test-discord-token";
process.env.DISCORD_CLIENT_ID = "test-discord-client-id";
process.env.TWITCH_CLIENT_ID = "test-twitch-client-id";
process.env.TWITCH_CLIENT_SECRET = "test-twitch-client-secret";
process.env.TWITCH_REFRESH_TOKEN = "test-twitch-refresh-token";
process.env.RIOT_API_KEY = "test-riot-api-key";
process.env.KICK_CLIENT_ID = "test-kick-client-id";
process.env.KICK_CLIENT_SECRET = "test-kick-client-secret";

// The connection module opens `${DB_PATH}/bot.sqlite` on import, so pointing it at
// a temp directory keeps the suite (and anything it writes through the default
// database, e.g. chat ingest) out of the developer's ./db. Wiped on every run so
// a leftover row cannot satisfy the next run's assertions.
const testDbDir = join(tmpdir(), "barker-tests");
rmSync(testDbDir, { recursive: true, force: true });
process.env.DB_PATH = testDbDir;

// Chat logging is exercised by the suite, and the flag is read once at import, so
// it has to be on here rather than inside a test. The channels match the fixtures
// the chat tests use.
process.env.CHAT_LOG_ENABLED = "true";
process.env.CHAT_LOG_CHANNELS = "twitch:alice,kick:alice";

// Keep the Discord send-queue pacing negligible so queue tests run fast.
process.env.DISCORD_QUEUE_DELAY_MS = "5";

// Keep HTTP retry backoff negligible so tests exercising fetchWithRetry's
// real retry behavior (e.g. against mocked 5xx responses) run fast.
process.env.HTTP_RETRY_BASE_DELAY_MS = "1";
