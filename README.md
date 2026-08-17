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

**GitHub Pages only serves static files** — it can't run the Express backend, Postgres, or Redis. So deployment splits in two: backend on Render, frontend on GitHub Pages.

### Backend (Render)

1. New Web Service on Render, pointed at `backend/` (root directory `backend`, build command `npm install`, start command `npm start`).
2. Add a Render Postgres database (or your own), then set these env vars on the **backend service** (Render dashboard → your service → Environment):

   | Var | Value | Notes |
   |---|---|---|
   | `DATABASE_URL` | the **Internal Database URL** from the Render Postgres dashboard | Internal is faster and free (private network) as long as the DB and web service are on Render in the same region. Use the External URL only for connecting from your own machine (`psql`, a GUI tool, etc). Paste it exactly as copied, `postgresql://...` prefix included. |
   | `JWT_SECRET` | a long random string | Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. If this is missing, the server boots fine but every login/signup/refresh crashes. |
   | `FRONTEND_ORIGIN` | `https://<your-username>.github.io` | **No trailing slash.** This has to match the `Origin` header the browser sends exactly, or every request gets silently CORS-rejected (shows up in the browser as a generic "network error", not a CORS message). |
   | `COOKIE_DOMAIN` | leave unset | See the cross-domain note below — this one should stay empty for the GitHub Pages + Render combo. |
   | `NODE_ENV` | `production` | Also flips on SSL for the Postgres connection, which Render's managed Postgres requires. |
   | `PORT` | leave unset | Render sets this itself. |

3. Run `schema.sql` against the database once (e.g. via `psql` using the **External** Database URL, or Render's built-in psql shell).
4. Redeploy, then check the boot logs. A healthy startup looks like:

   ```
   [config] FRONTEND_ORIGIN = https://f-gee.github.io
   [config] JWT_SECRET      = (set, 96 chars)
   [db] Startup connectivity check OK - connected to "..." at ...
   [startup] Enclave API listening on :10000
   ```

   If any of those three lines look wrong, fix that before touching the frontend — a backend issue will present as a frontend "fetch network error" and send you down the wrong path.
5. Sanity check by visiting `https://<your-service>.onrender.com/health` directly in a browser tab — should return `{"status":"ok",...}`.

### Frontend (GitHub Pages)

1. Copy `frontend/.env.production.example` to `frontend/.env.production` and set:
   ```
   VITE_API_URL=https://<your-service>.onrender.com
   ```
   **This is a build-time value** — Vite bakes it into the JS bundle when you run the build. Setting it anywhere else (Render, a shell export, after the fact) does nothing; the file has to exist with the right value *before* you build.
2. Edit `VITE_BASE_PATH` in the root `package.json`'s `deploy:pages` script to match your repo name (`/your-repo-name/`).
3. Build and deploy:
   ```bash
   npm run deploy:pages
   ```
   This builds with the GitHub Pages base path, copies `dist/index.html` to `dist/404.html` (so deep links / refreshes on routes like `/login` don't 404 — GitHub Pages has no server-side rewrite, so serving your own `index.html` as the 404 page lets React Router take over client-side), and pushes `frontend/dist` to the `gh-pages` branch. Enable Pages in your repo settings, pointing at the `gh-pages` branch.
4. Watch the **terminal** during the build — `vite.config.js` prints a block confirming what it's about to bake in:
   ```
   [vite-config] .env.production exists at that path? YES
   [vite-config] VITE_API_URL resolved = https://enclave-7y3y.onrender.com
   [vite-config] git commit            = 6e962c5
   ```
   If `VITE_API_URL` shows as not set here, no amount of redeploying fixes it — the `.env.production` file isn't in the place Vite is looking (should be directly in `frontend/`).
5. After deploying, hard refresh (or use incognito) — GitHub Pages sits behind a CDN and browsers cache aggressively, so a successful deploy doesn't always show up immediately. The app prints its version + git hash to the console and shows a small badge in the bottom-right corner (`v0.1.0 (6e962c5)`) — use that to confirm you're actually looking at the build you just pushed, not a stale cached one.

### The cross-domain cookie gotcha

The httpOnly-cookie auth flow assumes frontend and backend share a parent domain (e.g. `app.enclave.dev` / `api.enclave.dev`), which is what `COOKIE_DOMAIN` is for. GitHub Pages (`*.github.io`) and Render (`*.onrender.com`) do **not** share a domain, so:
- Leave `COOKIE_DOMAIN` unset on the backend (the cookie then defaults to the backend's own host)
- Keep `sameSite: 'none'` and `secure: true` (already the production default in `auth.js`) so the cookie is still sent cross-site
- This is exactly the scenario the CSRF token exists for — cross-site cookies are unavoidable here, so don't skip that middleware

If you'd rather sidestep this entirely for a quick demo deploy, swap the cookie-based auth for an `Authorization: Bearer` header stored in memory (see the note on this tradeoff in the auth routes' comments) — simpler across unrelated domains, at the cost of the httpOnly XSS protection.

### Debugging a broken deploy

Both sides log heavily on purpose, specifically to make this fast to diagnose:
- **Backend** (Render logs): startup prints every relevant env var (masked where sensitive), a Postgres connectivity check, and per-request `[req]`/`[res]`/`[cors]` lines. A CORS rejection logs exactly which `Origin` was rejected and what `FRONTEND_ORIGIN` it was compared against.
- **Frontend** (browser console): logs the resolved `API_URL` on load (red if it fell back to the localhost default), warns on mixed content (https page calling an http API), and on a failed request prints a numbered list of likely causes (wrong URL, backend down, mixed content, CORS, ad blocker).

Order of operations when something's broken: check the backend's own logs and `/health` endpoint first, since a backend problem shows up in the frontend as an identical-looking generic "network error" — chasing it as a frontend bug wastes time.



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
