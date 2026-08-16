require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

const authenticate = require('./middleware/authenticate');
const verifyCsrf = require('./middleware/csrf');
const scopeDb = require('./middleware/scopeDb');

const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');
const { router: inviteRoutes, publicRouter: publicInviteRoutes } = require('./routes/invites');

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
    const decoded = jwt.verify(parsed.accessToken, process.env.JWT_SECRET);
    socket.tenantId = decoded.tenantId;
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  socket.join(socket.tenantId);
});

app.use(cookieParser());
app.use(express.json());
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN,
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-CSRF-Token']
  })
);

// Make io available to route handlers as req.io
app.use((req, res, next) => {
  req.io = io;
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

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
  taskRoutes
);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Enclave API listening on :${PORT}`);
});
