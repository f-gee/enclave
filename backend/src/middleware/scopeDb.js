const ScopedDb = require('../db/scopedClient');

// Must run after `authenticate` (needs req.tenantId). Every route handler
// downstream uses req.db instead of importing the raw pool directly, so
// there's no code path where a query can accidentally skip the tenant filter.
function scopeDb(req, res, next) {
  req.db = new ScopedDb(req.tenantId);
  next();
}

module.exports = scopeDb;
