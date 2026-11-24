-- Migration 014: schema history.
--
-- One row per migration file applied to this database, keyed by file name,
-- with the sha256 checksum of the file as it was applied (line endings
-- normalised). scripts/install-db.mjs writes every row after a fresh install;
-- scripts/migrate.mjs reads them, refuses to run when a recorded checksum no
-- longer matches its file, and adds a row for each migration it applies.
--
-- `repo` is a fixed label. It stays only because GET /api/home selects it.
--
-- Service role only: RLS is on with no policies, and the anon and
-- authenticated roles hold no grants.
--
-- Written to be re-runnable.

create table if not exists schema_migrations (
  name text primary key,                    -- the file name, e.g. '013_crm_core.sql'
  checksum text not null,                   -- 'sha256:<hex>' of the file, line endings normalised
  repo text not null default 'solo-os',
  applied_at timestamptz not null default now(),
  applied_by text                           -- e.g. 'install-db' or 'migrate'
);

alter table schema_migrations enable row level security;

revoke all on table schema_migrations from anon, authenticated;
grant all on table schema_migrations to service_role;
