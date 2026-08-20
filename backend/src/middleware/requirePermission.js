// Sibling to requireRole.js, but for the /external/* surface: instead of
// checking a human's role, it checks the scopes granted to the API key
// making the request (see routes/apiKeys.js for how scopes are granted,
// middleware/apiKeyAuth.js for where req.apiKeyScopes gets populated).
//
// Only meaningful for API-key auth. If this ever ends up in front of a
// cookie-authenticated route (req.authMethod !== 'api-key'), it lets the
// request through unconditionally rather than blocking a real user on a
// concept - scopes - that only applies to machine credentials. requireRole
// is what gates human/session access; the two are deliberately independent
// so neither has to know about the other's model.
function requirePermission(scope) {
  return (req, res, next) => {
    if (req.authMethod !== 'api-key') {
      return next();
    }

    const granted = req.apiKeyScopes || [];
    if (!granted.includes(scope)) {
      console.warn(
        `[api-key] key ${req.apiKeyId} denied - missing scope "${scope}" (has: ${granted.join(', ') || 'none'})`
      );
      return res.status(403).json({
        error: `This API key does not have the "${scope}" scope`
      });
    }
    next();
  };
}

module.exports = requirePermission;
