const { client: redis, redisReady } = require('../config/redis');

/**
 * express-rate-limit (see middleware/rateLimiter.js) limits by IP, which is
 * the right tool for "stop credential stuffing on /login". It's the wrong
 * tool for "stop one noisy/compromised tenant from hammering the API and
 * degrading it for everyone else" - a tenant's own employees all share
 * (or rotate through) IPs, and an API key integration has no IP identity
 * at all. This limiter keys on `tenant_id` instead, using a fixed-window
 * counter.
 *
 * Backed by Redis (INCR + EXPIRE) so the count is shared correctly across
 * multiple backend instances - the exact case the README's own comment on
 * the IP limiter flags as a gap ("swap the memory store for
 * rate-limit-redis in production"). Falls back to an in-process Map when
 * Redis isn't configured/reachable, which is fine for local dev but will
 * under-count in a multi-instance deployment - a warning is logged once so
 * that's not a silent surprise in production.
 */
const memoryStore = new Map(); // tenantId -> { count, resetAt }
let warnedNoRedisInProd = false;

function windowKey(tenantId, windowMs) {
  const bucket = Math.floor(Date.now() / windowMs);
  return `ratelimit:tenant:${tenantId}:${bucket}`;
}

async function incrementRedis(key, windowSeconds) {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return count;
}

function incrementMemory(tenantId, windowMs) {
  const now = Date.now();
  const existing = memoryStore.get(tenantId);
  if (!existing || existing.resetAt <= now) {
    memoryStore.set(tenantId, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  existing.count += 1;
  return existing.count;
}

/**
 * tenantRateLimiter({ windowMs, max, label })
 * `label` is just for the log line, so a 429 on `/tasks` writes vs a 429 on
 * `/external/*` API-key traffic are distinguishable in the logs.
 */
function tenantRateLimiter({ windowMs = 60 * 1000, max = 120, label = 'default' } = {}) {
  return async function rateLimitByTenant(req, res, next) {
    const tenantId = req.tenantId;
    if (!tenantId) {
      // Must run after authenticate/apiKeyAuth. If it somehow doesn't have
      // a tenant yet, fail open rather than 500 - a downstream auth check
      // will reject the request anyway.
      return next();
    }

    try {
      let count;
      if (redisReady()) {
        count = await incrementRedis(windowKey(tenantId, windowMs), Math.ceil(windowMs / 1000));
      } else {
        if (process.env.NODE_ENV === 'production' && !warnedNoRedisInProd) {
          console.warn('[rate-limit] Running without Redis in production - tenant limits are per-instance, not global.');
          warnedNoRedisInProd = true;
        }
        count = incrementMemory(tenantId, windowMs);
      }

      res.set('X-RateLimit-Limit', String(max));
      res.set('X-RateLimit-Remaining', String(Math.max(0, max - count)));

      if (count > max) {
        console.warn(`[rate-limit] Tenant ${tenantId} exceeded ${label} limit (${count}/${max} in ${windowMs}ms window)`);
        return res.status(429).json({ error: 'Rate limit exceeded for this workspace. Please slow down.' });
      }

      next();
    } catch (err) {
      // A rate-limit backend hiccup should never take down the actual
      // request - log it and let the request through.
      console.error('[rate-limit] Backend error, failing open:', err.message);
      next();
    }
  };
}

module.exports = tenantRateLimiter;
