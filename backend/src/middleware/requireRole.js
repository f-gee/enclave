const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 };

// Usage: requireRole('admin') -> allows 'admin' and 'owner', blocks the rest.
// Hiding a delete button in the UI is not access control — this is the
// server-side check that actually matters.
function requireRole(minimumRole) {
  return (req, res, next) => {
    const callerRank = ROLE_RANK[req.user?.role] ?? -1;
    const requiredRank = ROLE_RANK[minimumRole] ?? Infinity;

    if (callerRank < requiredRank) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = requireRole;
