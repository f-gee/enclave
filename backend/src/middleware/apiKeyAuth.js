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
 * routes like inviting or deleting teammates. Fine-grained write access
 * (which resources a key can touch, not just "can it write at all") is
 * layered on top via req.apiKeyScopes + middleware/requirePermission.js.
 *
 * req.user.id is set to the key's creator rather than left null: any write
 * route that reuses the existing insert helpers (task.created_by, etc.)
 * needs a real user id to satisfy the NOT NULL/FK constraint on that
 * column, and attributing automated writes to "the admin who issued this
 * key" is a reasonable, auditable choice - it's also who's accountable if
 * the key leaks. req.apiKeyId is kept separately so audit log entries and
 * route logic can still tell a key-driven write apart from that admin
 * clicking around the UI themselves.
 */
async function apiKeyAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, rawKey] = header.split(' ');

  if (scheme !== 'Bearer' || !rawKey || !rawKey.startsWith(API_KEY_PREFIX)) {
    return res.status(401).json({ error: 'Missing or malformed API key. Use "Authorization: Bearer encl_live_..."' });
  }

  const keyHash = hashToken(rawKey);
  // Joined to users here (rather than a separate lookup in whichever route
  // happens to need an email, e.g. comment attribution) so every route
  // downstream gets a consistent req.user shape regardless of auth method.
  const result = await pool.query(
    `SELECT api_keys.*, users.email AS creator_email
     FROM api_keys
     JOIN users ON users.id = api_keys.created_by
     WHERE api_keys.key_hash = $1 AND api_keys.revoked = false`,
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
  req.user = { id: apiKey.created_by, role: 'member', email: apiKey.creator_email, apiKeyId: apiKey.id };
  req.apiKeyId = apiKey.id;
  req.apiKeyScopes = apiKey.permissions || [];
  req.authMethod = 'api-key';
  next();
}

module.exports = apiKeyAuth;
