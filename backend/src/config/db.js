const { Pool } = require('pg');

// Redact the password before this ever hits a log line.
function maskConnectionString(raw) {
  if (!raw) return '(not set)';
  try {
    const url = new URL(raw);
    const user = url.username || '(none)';
    const pass = url.password ? '***' : '(none)';
    return `${url.protocol}//${user}:${pass}@${url.hostname}:${url.port || '5432'}${url.pathname}${url.search}`;
  } catch (err) {
    return '(unparseable DATABASE_URL - check for typos/missing scheme)';
  }
}

console.log(`[db] DATABASE_URL = ${maskConnectionString(process.env.DATABASE_URL)}`);

// Render's Postgres requires SSL for external connections, but the SSL cert
// isn't in Node's default trust store, so `rejectUnauthorized: true` (the pg
// default) fails with a self-signed-cert error. Only relax this in
// production against Render — never disable verification for a DB you don't
// control.
const useSsl = process.env.NODE_ENV === 'production' || process.env.DATABASE_SSL === 'true';
console.log(`[db] SSL mode: ${useSsl ? 'enabled (rejectUnauthorized: false)' : 'disabled'}`);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false
});

pool.on('connect', () => {
  console.log('[db] New client connected to Postgres pool');
});

pool.on('error', (err) => {
  console.error('[db] Unexpected Postgres pool error:', err.message);
  console.error(err.stack);
});

// Fires once at boot so a bad DATABASE_URL / unreachable DB shows up
// immediately in the Render logs instead of surfacing later as a mysterious
// request timeout.
pool
  .query('SELECT NOW() as now, current_database() as db')
  .then((res) => {
    console.log(
      `[db] Startup connectivity check OK - connected to "${res.rows[0].db}" at ${res.rows[0].now}`
    );
  })
  .catch((err) => {
    console.error('[db] Startup connectivity check FAILED - the server will not be able to serve any DB-backed route.');
    console.error(`[db] Error code: ${err.code || '(none)'} | message: ${err.message}`);
    console.error(err.stack);
  });

module.exports = pool;
