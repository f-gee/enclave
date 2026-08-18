import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import TaskItem from '../components/TaskItem';
import MembersPanel from '../components/MembersPanel';
import AuditLogPanel from '../components/AuditLogPanel';
import ApiKeysPanel from '../components/ApiKeysPanel';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const isManager = (role) => role === 'admin' || role === 'owner';

export default function Dashboard() {
  const { user, tenant, logout } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [tab, setTab] = useState('tasks');

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

      <nav className="tabs">
        <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>Tasks</button>
        <button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>Members</button>
        {isManager(user?.role) && (
          <>
            <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>Audit log</button>
            <button className={tab === 'keys' ? 'active' : ''} onClick={() => setTab('keys')}>API keys</button>
          </>
        )}
      </nav>

      {tab === 'tasks' && (
        <>
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
                <TaskItem
                  key={task.id}
                  task={task}
                  canDelete={isManager(user?.role)}
                  onToggle={toggleStatus}
                  onDelete={deleteTask}
                  currentUserEmail={user?.email}
                />
              ))}
            </ul>
          </section>

          {isManager(user?.role) && (
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
        </>
      )}

      {tab === 'members' && <MembersPanel currentUser={user} canManage={isManager(user?.role)} />}
      {tab === 'audit' && isManager(user?.role) && <AuditLogPanel />}
      {tab === 'keys' && isManager(user?.role) && <ApiKeysPanel />}
    </div>
  );
}
