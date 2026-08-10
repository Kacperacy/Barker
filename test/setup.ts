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

// Keep the Discord send-queue pacing negligible so queue tests run fast.
process.env.DISCORD_QUEUE_DELAY_MS = "5";

// Keep HTTP retry backoff negligible so tests exercising fetchWithRetry's
// real retry behavior (e.g. against mocked 5xx responses) run fast.
process.env.HTTP_RETRY_BASE_DELAY_MS = "1";
