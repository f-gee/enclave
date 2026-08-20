import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { readLastTenantSlug } from '../api/tenantSlug';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  // Captured once on mount so we can tell "still showing what we
  // remembered" apart from "user typed something new" - the hint below
  // should disappear the moment they edit the field, not stay stuck on a
  // value that's no longer accurate.
  const [rememberedSlug] = useState(() => readLastTenantSlug());
  const [form, setForm] = useState(() => ({
    tenantSlug: rememberedSlug,
    email: '',
    password: ''
  }));
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      await login(form);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="auth-page">
      <h1>Log in to Enclave</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Workspace slug
          <input
            value={form.tenantSlug}
            onChange={(e) => setForm({ ...form, tenantSlug: e.target.value })}
            placeholder="acme-x7k2"
            required
          />
          {rememberedSlug && form.tenantSlug === rememberedSlug && (
            <span className="muted"> (remembered from last login)</span>
          )}
        </label>
        <label>
          Email
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
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit">Log in</button>
      </form>
      <p>
        No workspace yet? <Link to="/signup">Create one</Link>
      </p>
    </div>
  );
}
