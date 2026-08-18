require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

const authenticate = require('./middleware/authenticate');
const apiKeyAuth = require('./middleware/apiKeyAuth');
const verifyCsrf = require('./middleware/csrf');
const scopeDb = require('./middleware/scopeDb');
const tenantRateLimiter = require('./middleware/tenantRateLimiter');

const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');
const memberRoutes = require('./routes/members');
const auditRoutes = require('./routes/audit');
const apiKeyRoutes = require('./routes/apiKeys');
const externalRoutes = require('./routes/external');
const { router: inviteRoutes, publicRouter: publicInviteRoutes } = require('./routes/invites');

// --- Startup config dump ---------------------------------------------
// Prints exactly what the process sees at boot. On Render this is the
// fastest way to catch "env var wasn't set / has a trailing slash / has the
// wrong protocol" bugs without guessing.
console.log('--- Enclave API starting ---');
console.log(`[config] NODE_ENV        = ${process.env.NODE_ENV || '(not set - defaults to development behavior)'}`);
console.log(`[config] PORT            = ${process.env.PORT || '(not set - defaulting to 4000)'}`);
console.log(`[config] FRONTEND_ORIGIN = ${process.env.FRONTEND_ORIGIN || '(not set - CORS will reject every browser request!)'}`);
console.log(`[config] COOKIE_DOMAIN   = ${process.env.COOKIE_DOMAIN || '(not set - cookie will default to this host, which is correct for cross-domain setups like GitHub Pages + Render)'}`);
console.log(`[config] JWT_SECRET      = ${process.env.JWT_SECRET ? '(set, ' + process.env.JWT_SECRET.length + ' chars)' : '(NOT SET - auth will crash on every request)'}`);
console.log('----------------------------');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true
  }
});

// Socket auth: same JWT-in-cookie approach as HTTP, so a socket connection
// carries the same tenant guarantees as a normal request. Sockets join a
// room named after their tenant, so `io.to(tenantId).emit(...)` can never
// reach a client in a different tenant.
io.use((socket, next) => {
  try {
    const rawCookies = socket.handshake.headers.cookie || '';
    const parsed = cookie.parse(rawCookies);
    if (!parsed.accessToken) {
      console.warn('[socket] Handshake had no accessToken cookie - rejecting');
      return next(new Error('unauthorized'));
    }
    const decoded = jwt.verify(parsed.accessToken, process.env.JWT_SECRET);
    socket.tenantId = decoded.tenantId;
    socket.userId = decoded.userId;
    console.log(`[socket] Authenticated connection for tenant ${socket.tenantId}, user ${socket.userId}`);
    next();
  } catch (err) {
    console.warn(`[socket] Handshake rejected: ${err.message}`);
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  socket.join(socket.tenantId);
  console.log(`[socket] Socket ${socket.id} joined room ${socket.tenantId}`);
  socket.on('disconnect', (reason) => {
    console.log(`[socket] Socket ${socket.id} disconnected: ${reason}`);
  });
});

app.use(cookieParser());
app.use(express.json());

// Verbose request logger. Every request that actually reaches Express gets
// logged here - if you see fetch errors in the browser but NOTHING shows up
// in these logs, the request never made it to the server at all (DNS
// failure, wrong URL/port, Render service asleep/crashed, or blocked before
// it left the browser - e.g. mixed content). That distinction is the single
// most useful thing for narrowing down a "network error".
app.use((req, res, next) => {
  const start = Date.now();
  console.log(
    `[req] ${req.method} ${req.originalUrl} | Origin: ${req.headers.origin || '(none)'} | ` +
    `Content-Type: ${req.headers['content-type'] || '(none)'}`
  );
  res.on('finish', () => {
    console.log(
      `[res] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`
    );
  });
  next();
});

// Custom origin check (instead of a static string) purely so a rejected
// request gets logged with WHY it was rejected - the raw `cors` package just
// silently omits the Access-Control-Allow-Origin header, which the browser
// then reports as an opaque "Failed to fetch" with no explanation.
app.use(
  cors({
    origin(origin, callback) {
      const allowed = process.env.FRONTEND_ORIGIN;
      // `origin` is undefined for same-origin requests, curl, server-to-server, etc.
      if (!origin) {
        console.log('[cors] Request with no Origin header (non-browser or same-origin) - allowing');
        return callback(null, true);
      }
      if (origin === allowed) {
        console.log(`[cors] Origin ${origin} matches FRONTEND_ORIGIN - allowing`);
        return callback(null, true);
      }
      console.error(
        `[cors] REJECTED request from Origin "${origin}" - does not match FRONTEND_ORIGIN "${allowed}". ` +
        `This will show up in the browser as a generic network/fetch error, not a helpful CORS message. ` +
        `Check for trailing slashes, http vs https, or a stale env var on Render.`
      );
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-CSRF-Token']
  })
);

// Make io available to route handlers as req.io
app.use((req, res, next) => {
  req.io = io;
  next();
});

app.get('/health', (req, res) => {
  console.log('[health] Health check hit');
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/auth', authRoutes);

// Public: accepting an invite (no session exists yet)
app.use('/invites', publicInviteRoutes);
// Authenticated: creating invites (requires admin/owner + CSRF check)
app.use('/invites', authenticate, scopeDb, verifyCsrf, inviteRoutes);

app.use(
  '/tasks',
  authenticate,
  scopeDb,
  // CSRF check only applies to state-changing methods, not GET
  (req, res, next) => (req.method === 'GET' ? next() : verifyCsrf(req, res, next)),
  tenantRateLimiter({ windowMs: 60 * 1000, max: 240, label: 'tasks' }),
  taskRoutes
);

app.use(
  '/members',
  authenticate,
  scopeDb,
  (req, res, next) => (req.method === 'GET' ? next() : verifyCsrf(req, res, next)),
  memberRoutes
);

app.use('/audit', authenticate, scopeDb, auditRoutes);

app.use(
  '/api-keys',
  authenticate,
  scopeDb,
  (req, res, next) => (req.method === 'GET' ? next() : verifyCsrf(req, res, next)),
  apiKeyRoutes
);

// Machine-to-machine traffic: no cookies/CSRF, authenticated purely by the
// `Authorization: Bearer` header (see middleware/apiKeyAuth.js). Gets its
// own, tighter tenant rate limit since it's unattended integration traffic
// rather than a human clicking around.
app.use(
  '/external',
  apiKeyAuth,
  scopeDb,
  tenantRateLimiter({ windowMs: 60 * 1000, max: 60, label: 'external-api' }),
  externalRoutes
);

app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.originalUrl} -> ${err.status || 500}: ${err.message}`);
  console.error(err.stack);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`[startup] Enclave API listening on :${PORT}`);
});

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] Uncaught exception:', err);
});
