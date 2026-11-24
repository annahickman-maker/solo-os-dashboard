-- Solo OS documents: one JSON document per key (focus plan, reputation, offer).
-- Owner-only. Read and written through /api/solo/docs/[key] with the service role.
create table if not exists public.solo_documents (
  key text primary key check (key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.solo_documents enable row level security;
revoke all on public.solo_documents from anon, authenticated;
