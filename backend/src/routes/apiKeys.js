const express = require('express');
const { z } = require('zod');
const requireRole = require('../middleware/requireRole');
const { hashToken, generateApiKey } = require('../utils/tokens');
const { API_KEY_SCOPES } = require('../utils/scopes');

const router = express.Router();

async function logAudit(req, action, targetId, metadata = {}) {
  await req.db.insert('audit_log', {
    user_id: req.user.id,
    action,
    target_id: targetId,
    metadata: JSON.stringify(metadata)
  });
}

// Admin+ only for all of this - an API key is effectively a standing
// credential into the tenant's data, same trust level as inviting a member.
router.use(requireRole('admin'));

// Also returns permissions so the panel can show "this key can do X" -
// never returns key_hash, and the raw key is only ever generated below and
// returned exactly once at creation time.
router.get('/', async (req, res) => {
  const keys = await req.db.query(
    `SELECT id, name, prefix, permissions, revoked, last_used_at, created_at
     FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [req.tenantId]
  );
  res.json({ apiKeys: keys.rows, availableScopes: API_KEY_SCOPES });
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  // Explicit allowlist via z.enum - an unrecognized scope string is a 400,
  // not a silently-ignored no-op, so a typo'd scope fails at creation time
  // instead of quietly producing a key that can't do what its creator
  // thought it could. Defaults to [] (least privilege) if omitted entirely.
  permissions: z.array(z.enum(API_KEY_SCOPES)).default([])
});

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  // De-dupe in case the client sent the same scope twice.
  const permissions = [...new Set(parsed.data.permissions)];

  const { raw, prefix } = generateApiKey();
  const record = await req.db.insert('api_keys', {
    created_by: req.user.id,
    name: parsed.data.name,
    prefix,
    permissions,
    key_hash: hashToken(raw)
  });

  await logAudit(req, 'api_key.created', record.id, { name: record.name, permissions });

  res.status(201).json({
    apiKey: {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      permissions: record.permissions,
      created_at: record.created_at
    },
    // Shown once. The dashboard should tell the user to copy it now -
    // there is no "reveal" later, only revoke-and-recreate, same tradeoff
    // as every other secret-issuing flow in this app.
    key: raw
  });
});

router.delete('/:id', async (req, res) => {
  const key = await req.db.findOne('api_keys', 'id = $1', [req.params.id]);
  if (!key) return res.status(404).json({ error: 'API key not found' });

  await req.db.update('api_keys', req.params.id, { revoked: true });
  await logAudit(req, 'api_key.revoked', req.params.id, { name: key.name });

  res.json({ success: true });
});

module.exports = router;
