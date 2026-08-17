const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Loud and unmissable on purpose: the #1 cause of "fetch network error" on a
// deployed frontend is this resolving to localhost because VITE_API_URL
// wasn't set at BUILD time (Vite bakes it in - setting it on the host after
// the fact does nothing). Check this line in the browser console first.
console.log(
  `%c[api] API_URL = ${API_URL}${
    import.meta.env.VITE_API_URL ? '' : ' (VITE_API_URL not set at build time - falling back to default!)'
  }`,
  'font-weight: bold; color: ' + (import.meta.env.VITE_API_URL ? '#0a0' : '#c00')
);
if (typeof window !== 'undefined' && window.location.protocol === 'https:' && API_URL.startsWith('http://')) {
  console.error(
    '[api] Page is served over HTTPS but API_URL is HTTP. Browsers silently block this ' +
    '("mixed content") and it surfaces as an opaque fetch/network error with no CORS message at all.'
  );
}

function readCookie(name) {
  return document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
    ?.split('=')[1];
}

// The CSRF cookie itself is set by the backend (httpOnly: false) purely so
// same-domain deployments can read it via document.cookie. Ours is
// cross-domain (GitHub Pages frontend, Render backend), and a cookie's
// Domain scopes it to the site that set it - document.cookie on THIS origin
// will never see it, regardless of httpOnly. So instead: the backend also
// returns the token in the JSON body of /auth/signup, /auth/login, and
// /auth/refresh, and we hold it here in memory. Lost on full page reload by
// design - AuthContext re-establishes it via a silent refresh on mount.
let csrfTokenInMemory = null;
export function setCsrfToken(token) {
  csrfTokenInMemory = token;
  console.log(`[api] CSRF token ${token ? 'stored' : 'cleared'} in memory`);
}

let isRefreshing = null;

// Shared by the automatic 401-retry below AND by AuthContext's on-mount
// call. Deliberately a raw fetch, not apiFetch(path) - if this called
// apiFetch('/auth/refresh'), a 401 here (e.g. a visitor with no session at
// all) would trigger apiFetch's OWN 401-retry logic, which calls this same
// endpoint again and, on failure, redirects to /login - meaning every
// anonymous visitor would get bounced to /login on page load. Coalesces
// concurrent callers into a single in-flight request either way.
export function silentRefresh() {
  if (!isRefreshing) {
    isRefreshing = fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include'
    })
      .then(async (r) => {
        console.log(`[api] refresh -> ${r.status}`);
        if (r.ok) {
          const refreshData = await r.json().catch(() => null);
          if (refreshData?.csrfToken) setCsrfToken(refreshData.csrfToken);
        }
        return r;
      })
      .catch((err) => {
        console.error('[api] refresh call itself failed at the network level', err);
        return { ok: false };
      })
      .finally(() => {
        isRefreshing = null;
      });
  }
  return isRefreshing;
}

// Every call rides on the httpOnly cookies automatically (credentials:
// 'include') — this client never touches the access token directly. On a
// 401 it attempts one silent refresh (via the /auth/refresh cookie flow)
// before giving up and redirecting to login.
export async function apiFetch(path, options = {}) {
  // Kept as a fallback for same-domain local dev, where the cookie IS
  // readable - but the in-memory value (set from a JSON response) always
  // wins when we have it, since it's the only thing that works cross-domain.
  const csrfToken = csrfTokenInMemory || readCookie('csrfToken');
  const url = `${API_URL}${path}`;
  const requestId = Math.random().toString(36).slice(2, 8);

  console.log(`[api][${requestId}] -> ${options.method || 'GET'} ${url}`, {
    hasCsrfToken: Boolean(csrfToken),
    csrfSource: csrfTokenInMemory ? 'memory' : readCookie('csrfToken') ? 'cookie' : 'none',
    online: typeof navigator !== 'undefined' ? navigator.onLine : 'unknown'
  });

  let res;
  try {
    res = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        ...options.headers
      }
    });
  } catch (err) {
    // fetch() only throws for things that never got an HTTP response at
    // all: DNS failure, connection refused, CORS preflight rejection,
    // mixed-content blocking, or the backend being asleep/unreachable.
    // The browser deliberately gives no further detail than "Failed to
    // fetch" for security reasons, so we log every plausible cause here
    // instead of trying to guess which one it was.
    console.error(`[api][${requestId}] Network-level failure calling ${url}`, err);
    console.error(
      `[api][${requestId}] This means the request never reached the server. Check, in order: ` +
      `(1) is API_URL correct - see the [api] API_URL log above; ` +
      `(2) is the backend actually up (visit ${API_URL}/health directly in a new tab); ` +
      `(3) mixed content (https page calling http API); ` +
      `(4) CORS preflight rejected - check the backend logs for a [cors] REJECTED line; ` +
      `(5) an ad blocker/extension blocking the request.`
    );
    throw new Error(
      `Could not reach the API at ${API_URL}. Open the browser console for diagnostic details, ` +
      `or try visiting ${API_URL}/health directly.`
    );
  }

  console.log(`[api][${requestId}] <- ${res.status} ${res.statusText} for ${url}`);

  if (res.status === 401 && !options._retried) {
    console.log(`[api][${requestId}] 401 received, attempting silent refresh`);
    const refreshRes = await silentRefresh();
    if (refreshRes.ok) {
      return apiFetch(path, { ...options, _retried: true });
    }
    console.warn(`[api][${requestId}] Refresh failed, redirecting to /login`);
    window.location.href = '/login';
    return null;
  }

  const data = await res.json().catch((err) => {
    console.warn(`[api][${requestId}] Response was not valid JSON`, err);
    return null;
  });
  if (!res.ok) {
    console.error(`[api][${requestId}] Request failed:`, data?.error || res.statusText);
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}
