const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function readCookie(name) {
  return document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
    ?.split('=')[1];
}

let isRefreshing = null;

// Every call rides on the httpOnly cookies automatically (credentials:
// 'include') — this client never touches the access token directly. On a
// 401 it attempts one silent refresh (via the /auth/refresh cookie flow)
// before giving up and redirecting to login.
export async function apiFetch(path, options = {}) {
  const csrfToken = readCookie('csrfToken');

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...options.headers
    }
  });

  if (res.status === 401 && !options._retried) {
    if (!isRefreshing) {
      isRefreshing = fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include'
      }).finally(() => {
        isRefreshing = null;
      });
    }
    const refreshRes = await isRefreshing;
    if (refreshRes.ok) {
      return apiFetch(path, { ...options, _retried: true });
    }
    window.location.href = '/login';
    return null;
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}
