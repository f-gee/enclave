const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const pool = require('../config/db');
const requireRole = require('../middleware/requireRole');
const { hashToken, generateRefreshToken } = require('../utils/tokens');

// Two separate routers on purpose:
//   - `router` (authenticated): creating invites, requires an existing admin/owner
//   - `publicRouter` (no auth): accepting an invite, since the invitee has no
//     session yet — their identity comes entirely from the invite token itself
const router = express.Router();
const publicRouter = express.Router();

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']).default('member')
});

// Only admins/owners can invite new teammates into the tenant.
router.post('/', requireRole('admin'), async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { email, role } = parsed.data;

  const rawToken = generateRefreshToken(); // reuse: just a random opaque token
  const invite = await req.db.insert('invites', {
    email: email.toLowerCase(),
    role,
    token_hash: hashToken(rawToken)
  });

  await req.db.query(
    `UPDATE invites SET expires_at = now() + interval '7 days' WHERE id = $1`,
    [invite.id]
  );

  await req.db.insert('audit_log', {
    user_id: req.user.id,
    action: 'member.invited',
    target_id: invite.id,
    metadata: JSON.stringify({ email, role })
  });

  // In a real app: email `rawToken` to the invitee as a signup link.
  // Returned directly here since this is a starter scaffold with no mail provider wired up.
  res.status(201).json({ inviteLink: `/accept-invite?token=${rawToken}` });
});

const acceptSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200)
});

// Deliberately NOT behind `authenticate` — the invitee isn't logged in yet.
// Tenant + role come from the invite record itself, not from anything the
// client claims, so this can't be used to join an arbitrary tenant.
publicRouter.post('/accept', async (req, res) => {
  const parsed = acceptSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { token, password } = parsed.data;

  const result = await pool.query(
    `SELECT * FROM invites WHERE token_hash = $1 AND accepted = false AND expires_at > now()`,
    [hashToken(token)]
  );
  const invite = result.rows[0];
  if (!invite) return res.status(400).json({ error: 'Invalid or expired invite' });

  const passwordHash = await bcrypt.hash(password, 12);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id, email, role, tenant_id`,
      [invite.tenant_id, invite.email, passwordHash, invite.role]
    );
    await client.query(`UPDATE invites SET accepted = true WHERE id = $1`, [invite.id]);
    await client.query('COMMIT');
    res.status(201).json({ user: userResult.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That email is already a member of this workspace' });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not accept invite' });
  } finally {
    client.release();
  }
});

module.exports = { router, publicRouter };
