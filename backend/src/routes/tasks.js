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

module.exports = router;
