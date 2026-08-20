import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ companyName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const data = await signup(form);
      // Previously this called navigate('/dashboard') right after setting
      // tenantSlug, which fired before React ever painted the "save this
      // slug" message below - so it never had a chance to be seen. The
      // slug is now also remembered automatically for next time (see
      // AuthContext.jsx), but showing it here still matters: it's the
      // one moment the user can copy it somewhere of their own choosing
      // (a password manager, a note) instead of relying solely on this
      // browser's localStorage.
      setTenantSlug(data.tenant.slug);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="auth-page">
      <h1>Create your workspace</h1>
      {tenantSlug ? (
        <div className="callout">
          <p>Workspace created. Your login slug is:</p>
          <code className="secret">{tenantSlug}</code>
          <p className="muted">
            It's saved on this device for next time, but worth copying somewhere safe too
            (e.g. a password manager) in case you log in from elsewhere.
          </p>
          <button type="button" onClick={() => navigate('/dashboard')}>
            Continue to dashboard
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <label>
            Company name
            <input
              value={form.companyName}
              onChange={(e) => setForm({ ...form, companyName: e.target.value })}
              required
            />
          </label>
          <label>
            Your email
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit">Create workspace</button>
        </form>
      )}
      <p>
        Already have a workspace? <Link to="/login">Log in</Link>
      </p>
    </div>
  );
}
