const rateLimit = require('express-rate-limit');

// Basic brute-force / credential-stuffing mitigation on auth endpoints.
// Swap the default memory store for `rate-limit-redis` in production so
// limits are shared across multiple backend instances.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' }
});

module.exports = { authLimiter };
