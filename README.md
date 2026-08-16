# Enclave

🚀 **Live App:** [Frontend on GitHub Pages](https://f-gee.github.io/enclave) | ⚙️ **API:** [Backend on Render](https://enclave-7y3y.onrender.com)

A multi-tenant team task management SaaS starter — the kind of thing you'd get if Linear and Asana had a stripped-down open-source cousin. Built as a portfolio-grade scaffold to demonstrate multi-tenancy, auth, and security patterns end-to-end, not just in isolated snippets.

Every company that signs up gets its own **enclave** — an isolated workspace with its own members, roles, and tasks, sealed off from every other tenant on the same shared infrastructure.

## Stack

- **Backend:** Node.js, Express, PostgreSQL (raw SQL + `pg`, no heavy ORM so the tenant-scoping logic stays visible), Socket.io, Redis (refresh token / rate-limit store)
- **Frontend:** React (Vite), plain fetch-based API client (no axios magic hiding the cookie/CSRF flow)
- **Infra:** Docker Compose (Postgres + Redis + backend + frontend)

## Architecture at a glance

```
Browser (app.enclave.local)
      │  fetch(..., { credentials: 'include' })
      ▼
Express API (api.enclave.local)
      │  1. authenticate  -> verifies httpOnly JWT cookie, attaches req.user + req.tenantId
      │  2. verifyCsrf     -> checks X-CSRF-Token header against csrfToken cookie (state-changing routes only)
      │  3. scopeDb        -> wraps the Postgres client so every query is auto-filtered by tenant_id
      ▼
Postgres (Row Level Security enabled as a second line of defense)
```

## Security decisions (and why)

| Decision | Why |
|---|---|
| **httpOnly cookies, not localStorage, for the access token** | localStorage is readable by any JS on the page — including anything an XSS bug or compromised dependency injects. httpOnly cookies are invisible to JavaScript entirely. |
| **Short-lived JWT (15 min) + server-side refresh tokens** | Stateless JWTs can't be revoked early on their own. Pairing a short-lived JWT with a DB/Redis-backed refresh token means a removed user or revoked session is locked out within minutes, not whenever the token happens to expire. |
| **Explicit CSRF token (double-submit cookie pattern)** | The frontend and API live on different subdomains, which requires `SameSite=None` cookies — and `SameSite=None` disables the browser's built-in CSRF protection. The CSRF token fills that gap: a malicious site can trigger the cookie to be *sent*, but can't *read* it (same-origin policy) to also forge the matching header. |
| **`tenant_id` embedded in the signed JWT, not trusted from a request param** | If tenant identity were just `?tenant_id=123` in the URL, any authenticated user could try swapping IDs to peek at another tenant's data. Baking it into the signed token means it can't be tampered with client-side. |
| **Tenant-scoped DB wrapper (`ScopedDb`)** | The single most common real-world multi-tenant bug is a forgotten `WHERE tenant_id = ...`. Routes never touch the raw Postgres client directly — every query goes through a wrapper that injects the tenant filter automatically. |
| **Postgres Row Level Security as a second layer** | Defense in depth: even if a route somehow bypassed the scoped wrapper, the database itself refuses to return rows outside the current tenant context. |
| **Role checks enforced server-side, not just hidden in the UI** | Hiding an "delete" button in React is not access control. Every mutating route re-checks the caller's role against the DB. |
| **Rate limiting on `/login` and `/signup`** | Basic brute-force / credential-stuffing mitigation. |

## Getting started

```bash
npm install
npm run dev
```

This installs both workspaces and runs backend + frontend concurrently (requires Postgres + Redis running locally, or use Docker below).

```bash
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend: http://localhost:4000
- Postgres: localhost:5432
- Redis: localhost:6379

Run the schema once against the DB:

```bash
npm run db:migrate
```

Then sign up a company at `/signup` — this creates a tenant + an Owner user.

## Deployment

**GitHub Pages only serves static files** — it can't run the Express backend, Postgres, or Redis. So deployment splits in two:

1. **Backend** — deploy `backend/` to something that runs Node (Render, Railway, Fly.io all have free tiers). Provision managed Postgres + Redis there too, run `schema.sql` against it, and set the same env vars as `backend/.env.example`.
2. **Frontend** — once the backend has a live URL, copy `frontend/.env.production.example` to `frontend/.env.production` and set `VITE_API_URL` to it. Then:

   ```bash
   npm run deploy:pages
   ```

   This builds the frontend with the correct GitHub Pages base path and pushes `frontend/dist` to the `gh-pages` branch via the `gh-pages` package. Enable Pages in your repo settings, pointing at the `gh-pages` branch.

   Edit the `VITE_BASE_PATH` in the root `package.json`'s `deploy:pages` script to match your actual repo name (`/your-repo-name/`).

**One real gotcha worth knowing:** the httpOnly-cookie auth flow in this project assumes frontend and backend share a parent domain (e.g. `app.enclave.dev` / `api.enclave.dev`), which is what lets `COOKIE_DOMAIN` scope the cookie to both. GitHub Pages (`*.github.io`) and your backend host (`*.onrender.com`, etc.) do **not** share a domain, so:
- Remove/omit `COOKIE_DOMAIN` in the backend env (let the cookie default to the backend's own domain)
- Keep `sameSite: 'none'` and `secure: true` (already the production default in `auth.js`) so the cookie is still sent cross-site
- This is exactly the scenario the CSRF token exists for — cross-site cookies are unavoidable here, so don't skip that middleware

If you'd rather sidestep this entirely for a quick demo deploy, swap the cookie-based auth for an `Authorization: Bearer` header stored in memory (see the note on this tradeoff earlier in this conversation / the auth routes' comments) — simpler across unrelated domains, at the cost of the httpOnly XSS protection.

## Project structure

```
enclave/
├── backend/
│   └── src/
│       ├── server.js              # app entrypoint, CORS, socket.io setup
│       ├── config/db.js           # raw pg pool
│       ├── db/scopedClient.js     # tenant-scoped query wrapper (the "can't forget tenant_id" pattern)
│       ├── middleware/
│       │   ├── authenticate.js    # verifies JWT cookie -> req.user, req.tenantId
│       │   ├── csrf.js            # double-submit CSRF check
│       │   ├── scopeDb.js         # attaches req.db (ScopedDb) using req.tenantId
│       │   ├── requireRole.js     # server-side role/permission enforcement
│       │   └── rateLimiter.js
│       ├── routes/
│       │   ├── auth.js            # signup, login, refresh, logout
│       │   ├── invites.js         # invite teammate into a tenant
│       │   └── tasks.js           # tenant-scoped task CRUD + socket broadcast
│       └── utils/tokens.js
├── frontend/
│   └── src/
│       ├── api/client.js          # fetch wrapper, credentials + CSRF header, auto-refresh-on-401
│       ├── context/AuthContext.jsx
│       └── pages/{Login,Signup,Dashboard}.jsx
├── schema.sql                     # tables + Postgres RLS policies
└── docker-compose.yml
```

## What to build next (good next portfolio commits)

- Audit log table (`who did what, when`) — trivial to add given the scoped DB wrapper already knows `req.user` and `req.tenantId`
- Per-tenant API keys for external integrations
- Usage-based rate limiting per tenant (not just per IP)
- Swap Row Level Security to be the *only* enforcement layer and write a test that proves a forgotten `WHERE` clause still can't leak data
