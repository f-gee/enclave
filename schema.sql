-- Enclave schema
-- Run once: docker exec -i enclave-postgres psql -U enclave -d enclave < schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- owner | admin | member | viewer
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Every table ScopedDb.update() touches needs this: the wrapper always
  -- sets `updated_at = now()` on update (see db/scopedClient.js), so a
  -- table missing this column fails at query time, not at review time.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  token_hash TEXT NOT NULL,
  accepted BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  assignee_id UUID REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo', -- todo | in_progress | done
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,       -- e.g. 'task.created', 'task.deleted', 'member.invited'
  target_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-tenant API keys for external integrations. Only `key_hash` is ever
-- stored - the raw key is shown to the user exactly once, at creation time,
-- same pattern as refresh/invite tokens elsewhere in this schema. `prefix`
-- is a short, non-secret slice of the raw key kept around purely so the UI
-- can show "which key is this" (e.g. "encl_7f2a...") without ever storing
-- or re-displaying the secret itself.
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  revoked BOOLEAN NOT NULL DEFAULT false,
  -- Explicit, narrow scopes (e.g. 'tasks:read', 'tasks:write') rather than
  -- one implicit "API keys can do X" blanket - see backend/src/utils/scopes.js
  -- for the allowlist and middleware/requirePermission.js for enforcement.
  -- Defaults to empty (read-nothing, write-nothing) so a key is only as
  -- capable as what was explicitly granted at creation time.
  permissions TEXT[] NOT NULL DEFAULT '{}',
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- See the matching comment on users.updated_at - required by ScopedDb.update().
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helpful indexes: every tenant-scoped table gets an index on tenant_id
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_tasks_tenant ON tasks(tenant_id);
CREATE INDEX idx_invites_tenant ON invites(tenant_id);
CREATE INDEX idx_audit_tenant ON audit_log(tenant_id);
CREATE INDEX idx_comments_tenant ON task_comments(tenant_id);
CREATE INDEX idx_comments_task ON task_comments(task_id);
CREATE INDEX idx_apikeys_tenant ON api_keys(tenant_id);
-- api_keys is looked up by hash on every external-API request, before we
-- know the tenant, so it needs its own direct index (not just tenant_id).
CREATE INDEX idx_apikeys_hash ON api_keys(key_hash);

-- ─────────────────────────────────────────────────────────
-- Row Level Security: defense-in-depth beneath the app layer.
-- The app sets `app.current_tenant` at the start of each request
-- (see backend/src/db/scopedClient.js). Even a query that forgets
-- to filter by tenant_id will be silently scoped by Postgres itself.
-- ─────────────────────────────────────────────────────────

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_users ON users
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_tasks ON tasks
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_invites ON invites
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_audit ON audit_log
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_comments ON task_comments
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY tenant_isolation_apikeys ON api_keys
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ─────────────────────────────────────────────────────────
-- Migration: scoped API key permissions
-- Safe to re-run against a database that already has the tables above
-- (e.g. your existing Render Postgres instance) - IF NOT EXISTS makes this
-- a no-op if you're running the full schema.sql fresh instead.
-- ─────────────────────────────────────────────────────────
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS permissions TEXT[] NOT NULL DEFAULT '{}';
