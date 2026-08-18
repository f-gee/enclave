import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';

const ROLES = ['viewer', 'member', 'admin', 'owner'];

export default function MembersPanel({ currentUser, canManage }) {
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');

  async function load() {
    const data = await apiFetch('/members');
    if (data) setMembers(data.members);
  }

  useEffect(() => { load(); }, []);

  async function changeRole(id, role) {
    setError('');
    try {
      await apiFetch(`/members/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    setError('');
    try {
      await apiFetch(`/members/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section>
      <h2>Team members</h2>
      {error && <p className="error">{error}</p>}
      <ul className="plain-list">
        {members.map((m) => (
          <li key={m.id} className="row">
            <span>{m.email} {m.id === currentUser?.id && <em className="muted">(you)</em>}</span>
            {canManage && m.id !== currentUser?.id ? (
              <div className="row-actions">
                <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value)}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <button type="button" className="danger" onClick={() => remove(m.id)}>Remove</button>
              </div>
            ) : (
              <span className="badge">{m.role}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
