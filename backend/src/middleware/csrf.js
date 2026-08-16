// Double-submit cookie CSRF check.
// The csrfToken cookie is readable by JS (unlike accessToken), so the
// legitimate frontend — running on our own origin — can read it and echo it
// back as a header. A malicious site can trigger the cookie to be *sent*
// automatically, but same-origin policy stops it from *reading* the cookie
// value to forge the matching header.
function verifyCsrf(req, res, next) {
  const cookieToken = req.cookies.csrfToken;
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'CSRF validation failed' });
  }
  next();
}

module.exports = verifyCsrf;
