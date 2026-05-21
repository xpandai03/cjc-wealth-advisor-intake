-- RBAC: add a `role` column to users. Two roles —
--   'admin'     full access (the pre-RBAC behavior)
--   'marketing' limited access: Links, Submissions, Activity only
--
-- Backward-compatible: every existing row defaults to 'admin', so no current
-- admin loses access. SAFE TO RUN BEFORE the code deploy — old code simply
-- ignores the extra column. Running it before the deploy is in fact REQUIRED:
-- the new code SELECTs users.role, so the column must exist first.
--
-- drizzle-kit push is broken in this repo; run manually:
--   psql "$DATABASE_URL" -f lib/db/migrations/0003_user_role.sql

BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin';

COMMIT;
