const express = require('express');

const router = express.Router();

// Read-only on purpose. API keys (routes/apiKeys.js) are meant for external
// integrations pulling data out (e.g. a status dashboard, a reporting
// pipeline) - not for automating writes into the workspace. If a write use
// case comes up later, it should get its own explicit, narrower scope
// rather than inheriting full task-management rights.

router.get('/tasks', async (req, res) => {
  const tasks = await req.db.find('tasks');
  res.json({ tasks });
});

router.get('/tasks/:id/comments', async (req, res) => {
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

module.exports = router;
