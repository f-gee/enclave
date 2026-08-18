const express = require('express');
const { z } = require('zod');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

const taskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  assignee_id: z.string().uuid().optional().nullable()
});

async function logAudit(req, action, targetId, metadata = {}) {
  await req.db.insert('audit_log', {
    user_id: req.user.id,
    action,
    target_id: targetId,
    metadata: JSON.stringify(metadata)
  });
}

// GET /tasks — every request is scoped to req.tenantId via req.db, so this
// query is physically incapable of returning another tenant's rows.
router.get('/', async (req, res) => {
  const tasks = await req.db.find('tasks');
  res.json({ tasks });
});

router.post('/', async (req, res) => {
  const parsed = taskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }

  const task = await req.db.insert('tasks', {
    ...parsed.data,
    created_by: req.user.id,
    status: 'todo'
  });

  await logAudit(req, 'task.created', task.id, { title: task.title });

  req.io.to(req.tenantId).emit('task:created', task);
  res.status(201).json({ task });
});

router.patch('/:id', async (req, res) => {
  const allowedFields = ['title', 'description', 'status', 'assignee_id'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([key]) => allowedFields.includes(key))
  );

  const task = await req.db.update('tasks', req.params.id, updates);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  await logAudit(req, 'task.updated', task.id, updates);

  req.io.to(req.tenantId).emit('task:updated', task);
  res.json({ task });
});

// Only admins/owners can delete — members can create/update their own work
// but shouldn't be able to wipe out someone else's tasks.
router.delete('/:id', requireRole('admin'), async (req, res) => {
  const deleted = await req.db.delete('tasks', req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Task not found' });

  await logAudit(req, 'task.deleted', req.params.id);

  req.io.to(req.tenantId).emit('task:deleted', { id: req.params.id });
  res.json({ success: true });
});

// --- Comments ---------------------------------------------------------
// Nested under /tasks/:id/comments rather than a top-level /comments route
// so a comment can never be created without a task_id, and so the tenant +
// task-ownership check (task belongs to this tenant) happens once, here,
// instead of being re-derived in a separate router.

const commentSchema = z.object({
  body: z.string().min(1).max(2000)
});

router.get('/:id/comments', async (req, res) => {
  const task = await req.db.findOne('tasks', 'id = $1', [req.params.id]);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const result = await req.db.query(
    `SELECT task_comments.id, task_comments.body, task_comments.created_at,
            task_comments.user_id, users.email AS author_email
     FROM task_comments
     JOIN users ON users.id = task_comments.user_id
     WHERE task_comments.tenant_id = $1 AND task_comments.task_id = $2
     ORDER BY task_comments.created_at ASC`,
    [req.tenantId, req.params.id]
  );

  res.json({ comments: result.rows });
});

router.post('/:id/comments', async (req, res) => {
  const parsed = commentSchema.safeParse(req.body);
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

  const payload = { ...comment, author_email: req.user.email };
  req.io.to(req.tenantId).emit('comment:created', payload);
  res.status(201).json({ comment: payload });
});

module.exports = router;
