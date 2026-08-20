// Small, isolated on purpose (rather than folded into api/client.js) since
// this is plain browser localStorage, not the in-memory-only pattern the
// rest of client.js uses for the CSRF token. Wrapped in try/catch because
// localStorage can throw (private/incognito mode in some browsers, storage
// quota, disabled by an extension) - losing the remembered slug isn't worth
// crashing the login page over.
const STORAGE_KEY = 'enclave.lastTenantSlug';

export function readLastTenantSlug() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch (err) {
    console.warn('[tenantSlug] Could not read from localStorage', err);
    return '';
  }
}

export function saveLastTenantSlug(slug) {
  if (!slug) return;
  try {
    localStorage.setItem(STORAGE_KEY, slug);
  } catch (err) {
    console.warn('[tenantSlug] Could not write to localStorage', err);
  }
}
