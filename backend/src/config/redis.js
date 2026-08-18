const { createClient } = require('redis');

// Optional on purpose: local dev without Docker (`npm run dev` against a
// bare Postgres) shouldn't hard-crash just because Redis isn't running.
// Anything that wants Redis (tenant usage limiting, and eventually the
// refresh-token store per the README's "next steps") should check
// `redisReady()` and degrade gracefully rather than assume a connection.
let client = null;
let ready = false;

if (process.env.REDIS_URL) {
  client = createClient({ url: process.env.REDIS_URL });

  client.on('error', (err) => {
    ready = false;
    console.error('[redis] Client error:', err.message);
  });
  client.on('ready', () => {
    ready = true;
    console.log('[redis] Connected and ready');
  });
  client.on('end', () => {
    ready = false;
    console.warn('[redis] Connection closed');
  });

  client.connect().catch((err) => {
    console.error('[redis] Initial connection failed - tenant rate limiting will fall back to in-memory:', err.message);
  });
} else {
  console.warn('[redis] REDIS_URL not set - tenant rate limiting will use an in-memory store (fine for local dev, not for multi-instance deployments)');
}

function redisReady() {
  return ready && client !== null;
}

module.exports = { client, redisReady };
