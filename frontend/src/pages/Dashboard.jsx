import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export default function Dashboard() {
  const { user, tenant, logout } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');

  useEffect(() => {
    apiFetch('/tasks').then((data) => data && setTasks(data.tasks));

    // Real-time updates: the socket authenticates with the same httpOnly
    // cookie and the server places it in a room named after its tenant, so
    // this client only ever receives events scoped to its own workspace.
    const socket = io(API_URL, { withCredentials: true });
    socket.on('task:created', (task) => setTasks((prev) => [task, ...prev]));
    socket.on('task:updated', (task) =>
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
    );
    socket.on('task:deleted', ({ id }) =>
      setTasks((prev) => prev.filter((t) => t.id !== id))
    );

    return () => socket.disconnect();
  }, []);

  async function createTask(e) {
    e.preventDefault();
    if (!title.trim()) return;
    await apiFetch('/tasks', { method: 'POST', body: JSON.stringify({ title }) });
    setTitle('');
  }

  async function toggleStatus(task) {
    const next = task.status === 'done' ? 'todo' : 'done';
    await apiFetch(`/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: next })
    });
  }

  async function deleteTask(id) {
    await apiFetch(`/tasks/${id}`, { method: 'DELETE' });
  }

  async function sendInvite(e) {
    e.preventDefault();
    const data = await apiFetch('/invites', {
      method: 'POST',
      body: JSON.stringify({ email: inviteEmail, role: 'member' })
    });
    setInviteLink(data.inviteLink);
    setInviteEmail('');
  }

  return (
    <div className="dashboard">
      <header>
        <div>
          <strong>{tenant?.name}</strong> · {user?.email} ({user?.role})
        </div>
        <button onClick={logout}>Log out</button>
      </header>

      <section>
        <h2>Tasks</h2>
        <form onSubmit={createTask}>
          <input
            placeholder="New task title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="submit">Add</button>
        </form>
        <ul>
          {tasks.map((task) => (
            <li key={task.id} className={task.status === 'done' ? 'done' : ''}>
              <span onClick={() => toggleStatus(task)}>{task.title}</span>
              {(user?.role === 'admin' || user?.role === 'owner') && (
                <button onClick={() => deleteTask(task.id)}>Delete</button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {(user?.role === 'admin' || user?.role === 'owner') && (
        <section>
          <h2>Invite a teammate</h2>
          <form onSubmit={sendInvite}>
            <input
              type="email"
              placeholder="teammate@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
            />
            <button type="submit">Send invite</button>
          </form>
          {inviteLink && (
            <p>
              Invite link (would normally be emailed):{' '}
              <code>{inviteLink}</code>
            </p>
          )}
        </section>
      )}
    </div>
  );
}
