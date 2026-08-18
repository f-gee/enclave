const pool = require('../config/db');
const { hashToken, API_KEY_PREFIX } = require('../utils/tokens');

/**
 * Sibling to `authenticate.js`, for machine-to-machine callers instead of
 * browser sessions: no cookies, no CSRF dance (there's no browser/ambient-
 * credential confusion to defend against for a header the caller must set
 * explicitly), just `Authorization: Bearer <key>`.
 *
 * Populates req.tenantId / req.user exactly like the cookie flow does, so
 * every downstream piece (scopeDb, requireRole, tenantRateLimiter, route
 * handlers) works unmodified regardless of which auth path got the request
 * here. req.user.role is fixed at 'member' - API keys are meant for
 * read/write integration traffic, not for exercising owner/admin-only
 * routes like inviting or deleting teammates.
 */
async function apiKeyAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, rawKey] = header.split(' ');

  if (scheme !== 'Bearer' || !rawKey || !rawKey.startsWith(API_KEY_PREFIX)) {
    return res.status(401).json({ error: 'Missing or malformed API key. Use "Authorization: Bearer encl_live_..."' });
  }

  const keyHash = hashToken(rawKey);
  const result = await pool.query(
    `SELECT * FROM api_keys WHERE key_hash = $1 AND revoked = false`,
    [keyHash]
  );
  const apiKey = result.rows[0];
  if (!apiKey) {
    return res.status(401).json({ error: 'Invalid or revoked API key' });
  }

  // Best-effort, not awaited on the critical path - a slow/failed write
  // here shouldn't delay or break the actual request.
  pool
    .query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [apiKey.id])
    .catch((err) => console.error('[api-key] Failed to update last_used_at:', err.message));

  req.tenantId = apiKey.tenant_id;
  req.user = { id: null, role: 'member', apiKeyId: apiKey.id };
  req.authMethod = 'api-key';
  next();
}

module.exports = apiKeyAuth;
