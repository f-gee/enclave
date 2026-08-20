import { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';

// Fallback only - the real, authoritative list comes back from
// GET /api-keys as `availableScopes` (backend/src/utils/scopes.js), so a
// scope added on the backend shows up here without a frontend deploy.
// This exists purely so the form isn't empty on the very first render
// before that response lands.
const FALLBACK_SCOPES = ['tasks:read', 'tasks:write', 'comments:read', 'comments:write'];

const SCOPE_LABELS = {
  'tasks:read': 'Read tasks',
  'tasks:write': 'Create/update tasks',
  'comments:read': 'Read comments',
  'comments:write': 'Post comments'
};

export default function ApiKeysPanel() {
  const [keys, setKeys] = useState([]);
  const [availableScopes, setAvailableScopes] = useState(FALLBACK_SCOPES);
  const [name, setName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState([]);
  const [newKey, setNewKey] = useState(null); // { key, prefix, name } shown once
  const [error, setError] = useState('');

  async function load() {
    const data = await apiFetch('/api-keys');
    if (data) {
      setKeys(data.apiKeys);
      if (data.availableScopes?.length) setAvailableScopes(data.availableScopes);
    }
  }

  useEffect(() => { load(); }, []);

  function toggleScope(scope) {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  }

  async function createKey(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    try {
      const data = await apiFetch('/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), permissions: selectedScopes })
      });
      setNewKey(data.key);
      setName('');
      setSelectedScopes([]);
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
        For external integrations. Send <code>Authorization: Bearer &lt;key&gt;</code> to{' '}
        <code>/external/*</code>. Each key can only reach the endpoints covered by the scopes you
        grant it below — a key created with no scopes checked can authenticate but can't read or
        write anything.
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
        <fieldset className="scope-picker">
          <legend>Scopes</legend>
          {availableScopes.map((scope) => (
            <label key={scope} className="scope-option">
              <input
                type="checkbox"
                checked={selectedScopes.includes(scope)}
                onChange={() => toggleScope(scope)}
              />
              {SCOPE_LABELS[scope] || scope}
            </label>
          ))}
        </fieldset>
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
              <br />
              <span className="muted scope-list">
                {k.permissions?.length
                  ? k.permissions.map((s) => SCOPE_LABELS[s] || s).join(', ')
                  : 'No scopes granted'}
              </span>
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
