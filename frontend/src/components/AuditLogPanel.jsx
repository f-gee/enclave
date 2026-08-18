import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';

function describe(entry) {
  const meta = entry.metadata || {};
  switch (entry.action) {
    case 'task.created': return `created task "${meta.title ?? ''}"`;
    case 'task.updated': return `updated a task`;
    case 'task.deleted': return `deleted a task`;
    case 'task.commented': return `commented on a task`;
    case 'member.invited': return `invited ${meta.email ?? 'someone'} as ${meta.role ?? 'member'}`;
    case 'member.role_changed': return `changed a member's role from ${meta.from} to ${meta.to}`;
    case 'member.removed': return `removed ${meta.email ?? 'a member'}`;
    case 'api_key.created': return `created API key "${meta.name ?? ''}"`;
    case 'api_key.revoked': return `revoked API key "${meta.name ?? ''}"`;
    default: return entry.action;
  }
}

export default function AuditLogPanel() {
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    apiFetch('/audit').then((data) => data && setEntries(data.entries));
  }, []);

  return (
    <section>
      <h2>Audit log</h2>
      {entries.length === 0 && <p className="muted">No activity yet.</p>}
      <ul className="plain-list">
        {entries.map((e) => (
          <li key={e.id} className="row audit-row">
            <span>
              <strong>{e.actor_email || 'system'}</strong> {describe(e)}
            </span>
            <time className="muted">{new Date(e.created_at).toLocaleString()}</time>
          </li>
        ))}
      </ul>
    </section>
  );
}
