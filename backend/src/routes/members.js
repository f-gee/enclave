const express = require('express');
const { z } = require('zod');
const requireRole = require('../middleware/requireRole');

const router = express.Router();
const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 };

async function logAudit(req, action, targetId, metadata = {}) {
  await req.db.insert('audit_log', {
    user_id: req.user.id,
    action,
    target_id: targetId,
    metadata: JSON.stringify(metadata)
  });
}

// Any authenticated member can see who else is in the workspace.
router.get('/', async (req, res) => {
  const members = await req.db.query(
    `SELECT id, email, role, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at ASC`,
    [req.tenantId]
  );
  res.json({ members: members.rows });
});

const roleUpdateSchema = z.object({
  role: z.enum(['viewer', 'member', 'admin', 'owner'])
});

// Admin+ only, and a caller can never grant a role higher than their own -
// an admin can promote someone to admin, but only an owner can create
// another owner. Mirrors requireRole's "hiding it in the UI isn't
// enforcement" philosophy.
router.patch('/:id', requireRole('admin'), async (req, res) => {
  const parsed = roleUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { role: newRole } = parsed.data;
  const callerRank = ROLE_RANK[req.user.role];

  if (ROLE_RANK[newRole] > callerRank) {
    return res.status(403).json({ error: `You can't grant a role higher than your own (${req.user.role})` });
  }

  const target = await req.db.findOne('users', 'id = $1', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'Member not found' });

  if (ROLE_RANK[target.role] > callerRank) {
    return res.status(403).json({ error: "You can't change the role of someone above your own rank" });
  }

  if (target.role === 'owner' && newRole !== 'owner') {
    const owners = await req.db.find('users', "role = 'owner'");
    if (owners.length <= 1) {
      return res.status(409).json({ error: 'Cannot demote the last owner. Promote another member to owner first.' });
    }
  }

  const updated = await req.db.update('users', req.params.id, { role: newRole });
  await logAudit(req, 'member.role_changed', updated.id, { from: target.role, to: newRole });

  res.json({ member: { id: updated.id, email: updated.email, role: updated.role } });
});

// Admin+ only. Same "can't act on someone above your rank" + "can't strand
// the workspace without an owner" guards as the role-change route above.
router.delete('/:id', requireRole('admin'), async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "You can't remove yourself. Ask another owner/admin to do it." });
  }

  const target = await req.db.findOne('users', 'id = $1', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'Member not found' });

  const callerRank = ROLE_RANK[req.user.role];
  if (ROLE_RANK[target.role] > callerRank) {
    return res.status(403).json({ error: "You can't remove someone above your own rank" });
  }

  if (target.role === 'owner') {
    const owners = await req.db.find('users', "role = 'owner'");
    if (owners.length <= 1) {
      return res.status(409).json({ error: 'Cannot remove the last owner.' });
    }
  }

  await req.db.delete('users', req.params.id);
  await logAudit(req, 'member.removed', req.params.id, { email: target.email, role: target.role });

  res.json({ success: true });
});

module.exports = router;
