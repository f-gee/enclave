const express = require('express');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const pool = require('../config/db');
const { authLimiter } = require('../middleware/rateLimiter');
const {
  REFRESH_TOKEN_TTL_MS,
  signAccessToken,
  generateRefreshToken,
  hashToken,
  generateCsrfToken
} = require('../utils/tokens');

const router = express.Router();

const isProd = process.env.NODE_ENV === 'production';
const baseCookieOpts = {
  secure: isProd,               // HTTPS only in production; relaxed for local http dev
  sameSite: isProd ? 'none' : 'lax',
  domain: process.env.COOKIE_DOMAIN
};

function setAuthCookies(res, accessToken, refreshToken, csrfToken) {
  res.cookie('accessToken', accessToken, {
    ...baseCookieOpts,
    httpOnly: true,
    maxAge: 15 * 60 * 1000
  });
  res.cookie('refreshToken', refreshToken, {
    ...baseCookieOpts,
    httpOnly: true,
    path: '/auth/refresh',
    maxAge: REFRESH_TOKEN_TTL_MS
  });
  res.cookie('csrfToken', csrfToken, {
    ...baseCookieOpts,
    httpOnly: false, // must be readable by frontend JS to echo back as a header
    maxAge: REFRESH_TOKEN_TTL_MS
  });
}

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const signupSchema = z.object({
  companyName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200)
});

// Creates a brand-new tenant + its first user (Owner role).
router.post('/signup', authLimiter, async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { companyName, email, password } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const slug = slugify(companyName) + '-' + Math.random().toString(36).slice(2, 6);

    const tenantResult = await client.query(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING *`,
      [companyName, slug]
    );
    const tenant = tenantResult.rows[0];

    const passwordHash = await bcrypt.hash(password, 12);
    const userResult = await client.query(
      `INSERT INTO users (tenant_id, email, password_hash, role)
       VALUES ($1, $2, $3, 'owner') RETURNING *`,
      [tenant.id, email.toLowerCase(), passwordHash]
    );
    const user = userResult.rows[0];

    await client.query('COMMIT');

    const accessToken = signAccessToken(user);
    const refreshToken = generateRefreshToken();
    const csrfToken = generateCsrfToken();

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, tenant_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '30 days')`,
      [user.id, tenant.id, hashToken(refreshToken)]
    );

    setAuthCookies(res, accessToken, refreshToken, csrfToken);
    res.status(201).json({
      user: { id: user.id, email: user.email, role: user.role },
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      // The CSRF cookie is set with httpOnly: false specifically so
      // frontend JS can read it - but that only works when frontend and
      // backend share a domain. GitHub Pages + Render don't, so JS on the
      // frontend origin can never see a cookie whose Domain is the backend's
      // host. Sending the value in the body too lets the frontend hold it
      // in memory instead, while the cookie itself still exists for the
      // backend to compare against on the next request.
      csrfToken
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That company or email is already registered' });
    }
    console.error(err);
    res.status(500).json({ error: 'Signup failed' });
  } finally {
    client.release();
  }
});

const loginSchema = z.object({
  tenantSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1)
});

router.post('/login', authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const { tenantSlug, email, password } = parsed.data;

  const tenantResult = await pool.query(`SELECT * FROM tenants WHERE slug = $1`, [tenantSlug]);
  const tenant = tenantResult.rows[0];
  // Generic error message regardless of *which* piece was wrong (tenant,
  // email, or password) — avoids leaking which companies/emails exist.
  const genericError = () => res.status(401).json({ error: 'Invalid credentials' });
  if (!tenant) return genericError();

  const userResult = await pool.query(
    `SELECT * FROM users WHERE tenant_id = $1 AND email = $2`,
    [tenant.id, email.toLowerCase()]
  );
  const user = userResult.rows[0];
  if (!user) return genericError();

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) return genericError();

  const accessToken = signAccessToken(user);
  const refreshToken = generateRefreshToken();
  const csrfToken = generateCsrfToken();

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, tenant_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + interval '30 days')`,
    [user.id, tenant.id, hashToken(refreshToken)]
  );

  setAuthCookies(res, accessToken, refreshToken, csrfToken);
  res.json({
    user: { id: user.id, email: user.email, role: user.role },
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    // See the matching comment in /signup - the frontend can't read this
    // cookie's value cross-domain, so it's handed over directly here too.
    csrfToken
  });
});

// Exchanges a valid refresh token for a new short-lived access token.
// Re-checks tenant membership fresh from the DB each time — this is the
// natural checkpoint where a revoked/removed user actually gets locked out.
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });

  const tokenHash = hashToken(refreshToken);
  const stored = await pool.query(
    `SELECT * FROM refresh_tokens WHERE token_hash = $1`,
    [tokenHash]
  );
  const record = stored.rows[0];

  if (!record || record.revoked || new Date(record.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  const userResult = await pool.query(
    `SELECT * FROM users WHERE id = $1 AND tenant_id = $2`,
    [record.user_id, record.tenant_id]
  );
  const user = userResult.rows[0];
  if (!user) {
    return res.status(403).json({ error: 'User no longer belongs to this tenant' });
  }

  const accessToken = signAccessToken(user);
  res.cookie('accessToken', accessToken, {
    ...baseCookieOpts,
    httpOnly: true,
    maxAge: 15 * 60 * 1000
  });

  // Rotate the CSRF token too, and hand the new value back in the body for
  // the same reason as /signup and /login - the frontend can't read it back
  // out of document.cookie cross-domain.
  const csrfToken = generateCsrfToken();
  res.cookie('csrfToken', csrfToken, {
    ...baseCookieOpts,
    httpOnly: false,
    maxAge: REFRESH_TOKEN_TTL_MS
  });

  res.json({ success: true, csrfToken });
});

router.post('/logout', async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (refreshToken) {
    await pool.query(
      `UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1`,
      [hashToken(refreshToken)]
    );
  }
  res.clearCookie('accessToken', baseCookieOpts);
  res.clearCookie('refreshToken', { ...baseCookieOpts, path: '/auth/refresh' });
  res.clearCookie('csrfToken', baseCookieOpts);
  res.json({ success: true });
});

module.exports = router;
