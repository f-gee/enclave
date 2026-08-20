// Single source of truth for API key scopes, imported by both the
// apiKeys.js validation (what a caller is allowed to grant) and
// external.js (what a given route requires). Keeping this as an explicit
// allowlist - rather than letting routes invent scope strings inline -
// means a typo in a route's requirePermission() call fails loudly (the
// scope just never matches anything a key can hold) instead of silently
// creating an ungrantable, unreachable permission.
const API_KEY_SCOPES = Object.freeze([
  'tasks:read',
  'tasks:write',
  'comments:read',
  'comments:write'
]);

module.exports = { API_KEY_SCOPES };
