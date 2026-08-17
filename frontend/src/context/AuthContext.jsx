import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { apiFetch, setCsrfToken, silentRefresh } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [initializing, setInitializing] = useState(true);

  // The in-memory CSRF token (see api/client.js) is lost on every full page
  // load/refresh - there's no session storage happening here on purpose,
  // it's re-derived from the httpOnly refresh-token cookie instead. Uses
  // silentRefresh() directly (not apiFetch) so a 401 here - completely
  // normal for a first-time/logged-out visitor - doesn't trigger apiFetch's
  // own 401-retry-then-redirect logic and bounce everyone to /login on load.
  useEffect(() => {
    let cancelled = false;
    silentRefresh()
      .then((res) => {
        // silentRefresh() already stores the CSRF token in memory on
        // success; a failed/expired/absent session is expected here, not
        // an error - nothing else to do in that case.
        void res;
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async ({ tenantSlug, email, password }) => {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ tenantSlug, email, password })
    });
    setCsrfToken(data.csrfToken);
    setUser(data.user);
    setTenant(data.tenant);
    return data;
  }, []);

  const signup = useCallback(async ({ companyName, email, password }) => {
    const data = await apiFetch('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ companyName, email, password })
    });
    setCsrfToken(data.csrfToken);
    setUser(data.user);
    setTenant(data.tenant);
    return data;
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' });
    setCsrfToken(null);
    setUser(null);
    setTenant(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, tenant, initializing, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
