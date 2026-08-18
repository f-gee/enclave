import { useState } from 'react';
import { apiFetch } from '../api/client';

export default function TaskItem({ task, canDelete, onToggle, onDelete, currentUserEmail }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState(null); // null = not loaded yet
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && comments === null) {
      setLoading(true);
      try {
        const data = await apiFetch(`/tasks/${task.id}/comments`);
        setComments(data?.comments || []);
      } finally {
        setLoading(false);
      }
    }
  }

  async function submitComment(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    const data = await apiFetch(`/tasks/${task.id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: draft.trim() })
    });
    if (data?.comment) {
      setComments((prev) => [...(prev || []), data.comment]);
    }
    setDraft('');
  }

  return (
    <li className={`task-item ${task.status === 'done' ? 'done' : ''}`}>
      <div className="task-row">
        <span className="task-title" onClick={() => onToggle(task)}>{task.title}</span>
        <div className="task-actions">
          <button type="button" className="ghost" onClick={toggleOpen}>
            {open ? 'Hide' : 'Comments'}
          </button>
          {canDelete && (
            <button type="button" className="danger" onClick={() => onDelete(task.id)}>Delete</button>
          )}
        </div>
      </div>

      {open && (
        <div className="comments">
          {loading && <p className="muted">Loading comments…</p>}
          {!loading && comments?.length === 0 && <p className="muted">No comments yet.</p>}
          {!loading && comments?.map((c) => (
            <div key={c.id} className="comment">
              <strong>{c.author_email === currentUserEmail ? 'You' : c.author_email}</strong>
              <span>{c.body}</span>
              <time>{new Date(c.created_at).toLocaleString()}</time>
            </div>
          ))}
          <form onSubmit={submitComment} className="comment-form">
            <input
              placeholder="Add a comment…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button type="submit">Post</button>
          </form>
        </div>
      )}
    </li>
  );
}
