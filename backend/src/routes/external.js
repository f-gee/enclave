const express = require('express');
const { z } = require('zod');
const requirePermission = require('../middleware/requirePermission');

const router = express.Router();

// Every route below is scope-gated (see middleware/requirePermission.js and
// backend/src/utils/scopes.js for the allowlist a key can be granted).
// A key with no scopes at all - the default - can reach none of these; it
// authenticates successfully but every route 403s until its owner grants
// it something specific. That's the point of this file existing separately
// from routes/tasks.js: it's the one place where "what can automated
// traffic touch" is decided per-key instead of inherited wholesale from
// whatever a human member can do.

async function logAudit(req, action, targetId, metadata = {}) {
  await req.db.insert('audit_log', {
    user_id: req.user.id,
    action,
    target_id: targetId,
    metadata: JSON.stringify({ ...metadata, via: 'api_key', api_key_id: req.apiKeyId })
  });
}

// --- Tasks ----------------------------------------------------------------

router.get('/tasks', requirePermission('tasks:read'), async (req, res) => {
  const tasks = await req.db.find('tasks');
  res.json({ tasks });
});

const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  assignee_id: z.string().uuid().optional().nullable()
});

router.post('/tasks', requirePermission('tasks:write'), async (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const task = await req.db.insert('tasks', {
    ...parsed.data,
    created_by: req.user.id,
    status: 'todo'
  });

  await logAudit(req, 'task.created', task.id, { title: task.title });

  // Same tenant-scoped socket room tasks.js broadcasts to, so a task
  // created via API key shows up live in the dashboard exactly like one
  // created by a human, with no separate "did a sync happen yet" question.
  req.io.to(req.tenantId).emit('task:created', task);
  res.status(201).json({ task });
});

// Deliberately narrower than the human-facing PATCH /tasks/:id: status and
// assignee are the two fields an external system (a CI pipeline flipping a
// task to "done", a ticketing sync reassigning work) plausibly needs to
// touch. title/description are left to routes/tasks.js for now - if that
// turns out to be too narrow, widen this schema rather than opening the
// route up to arbitrary body keys.
const updateTaskSchema = z.object({
  status: z.enum(['todo', 'in_progress', 'done']).optional(),
  assignee_id: z.string().uuid().optional().nullable()
});

router.patch('/tasks/:id', requirePermission('tasks:write'), async (req, res) => {
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: 'Provide at least one of: status, assignee_id' });
  }

  const task = await req.db.update('tasks', req.params.id, parsed.data);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  await logAudit(req, 'task.updated', task.id, parsed.data);

  req.io.to(req.tenantId).emit('task:updated', task);
  res.json({ task });
});

// --- Comments ---------------------------------------------------------------

router.get('/tasks/:id/comments', requirePermission('comments:read'), async (req, res) => {
  const task = await req.db.findOne('tasks', 'id = $1', [req.params.id]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const result = await req.db.query(
    `SELECT task_comments.id, task_comments.body, task_comments.created_at, users.email AS author_email
     FROM task_comments
     JOIN users ON users.id = task_comments.user_id
     WHERE task_comments.tenant_id = $1 AND task_comments.task_id = $2
     ORDER BY task_comments.created_at ASC`,
    [req.tenantId, req.params.id]
  );
  res.json({ comments: result.rows });
});

const createCommentSchema = z.object({
  body: z.string().min(1).max(2000)
});

router.post('/tasks/:id/comments', requirePermission('comments:write'), async (req, res) => {
  const parsed = createCommentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const task = await req.db.findOne('tasks', 'id = $1', [req.params.id]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const comment = await req.db.insert('task_comments', {
    task_id: req.params.id,
    user_id: req.user.id,
    body: parsed.data.body
  });

  await logAudit(req, 'task.commented', task.id, { comment_id: comment.id });

  // req.user.email is populated in apiKeyAuth.js from the key's creator, so
  // this is attributed the same way the human-facing route attributes it.
  const payload = { ...comment, author_email: req.user.email || null };
  req.io.to(req.tenantId).emit('comment:created', payload);
  res.status(201).json({ comment: payload });
});

module.exports = router;
