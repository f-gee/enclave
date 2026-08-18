import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';

export default function ApiKeysPanel() {
  const [keys, setKeys] = useState([]);
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState(null); // { key, prefix, name } shown once
  const [error, setError] = useState('');

  async function load() {
    const data = await apiFetch('/api-keys');
    if (data) setKeys(data.apiKeys);
  }

  useEffect(() => { load(); }, []);

  async function createKey(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    try {
      const data = await apiFetch('/api-keys', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      setNewKey(data.key);
      setName('');
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function revoke(id) {
    setError('');
    try {
      await apiFetch(`/api-keys/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section>
      <h2>API keys</h2>
      <p className="muted">
        For external integrations. Send <code>Authorization: Bearer &lt;key&gt;</code> to the{' '}
        <code>/external/*</code> read-only endpoints.
      </p>
      {error && <p className="error">{error}</p>}

      {newKey && (
        <div className="callout">
          <p>Copy this key now — it won't be shown again.</p>
          <code className="secret">{newKey}</code>
          <button type="button" onClick={() => setNewKey(null)}>Done</button>
        </div>
      )}

      <form onSubmit={createKey}>
        <input
          placeholder="Key name (e.g. reporting-dashboard)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit">Create key</button>
      </form>

      <ul className="plain-list">
        {keys.map((k) => (
          <li key={k.id} className="row">
            <span>
              <strong>{k.name}</strong> · <code>{k.prefix}…</code>{' '}
              {k.revoked && <em className="muted">(revoked)</em>}
              {!k.revoked && k.last_used_at && (
                <span className="muted"> · last used {new Date(k.last_used_at).toLocaleString()}</span>
              )}
            </span>
            {!k.revoked && (
              <button type="button" className="danger" onClick={() => revoke(k.id)}>Revoke</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
