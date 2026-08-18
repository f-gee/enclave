const jwt = require('jsonwebtoken');

// Reads the access token from the httpOnly cookie (never from a header the
// client could forge), verifies its signature, and attaches the caller's
// identity + tenant context to the request for every downstream handler.
function authenticate(req, res, next) {
  const token = req.cookies.accessToken;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.userId, role: decoded.role, email: decoded.email };
    req.tenantId = decoded.tenantId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

module.exports = authenticate;
