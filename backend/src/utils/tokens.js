const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function signAccessToken(user) {
  return jwt.sign(
    { userId: user.id, tenantId: user.tenant_id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Prefixed like Stripe/GitHub-style keys (`encl_live_...`) so a leaked key
// is instantly recognizable in logs, and so `prefix` (the first chunk) can
// be safely stored/displayed without revealing the secret - same idea as
// only ever storing `token_hash` for refresh/invite tokens above.
const API_KEY_PREFIX = 'encl_live_';

function generateApiKey() {
  const raw = API_KEY_PREFIX + crypto.randomBytes(24).toString('hex');
  const prefix = raw.slice(0, API_KEY_PREFIX.length + 8); // enough to recognize, not enough to guess
  return { raw, prefix };
}

module.exports = {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_MS,
  API_KEY_PREFIX,
  signAccessToken,
  generateRefreshToken,
  hashToken,
  generateCsrfToken,
  generateApiKey
};
