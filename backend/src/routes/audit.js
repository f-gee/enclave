const express = require('express');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

// Admin+ only - the audit log can reveal things like who's being invited/
// removed, so it gets the same visibility bar as membership management,
// not the "any member can see it" bar that GET /members gets.
router.get('/', requireRole('admin'), async (req, res) => {
  const limit = Math.min(Number.parseInt(req.query.limit, 10) || 50, 200);

  const result = await req.db.query(
    `SELECT audit_log.id, audit_log.action, audit_log.target_id, audit_log.metadata, audit_log.created_at,
            users.email AS actor_email
     FROM audit_log
     LEFT JOIN users ON users.id = audit_log.user_id
     WHERE audit_log.tenant_id = $1
     ORDER BY audit_log.created_at DESC
     LIMIT $2`,
    [req.tenantId, limit]
  );

  res.json({ entries: result.rows });
});

module.exports = router;
