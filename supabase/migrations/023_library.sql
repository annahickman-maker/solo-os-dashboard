-- Library: an index of the owner's images, videos, audio and documents.
-- PREVIEWS ONLY. Originals stay where they live (a folder on the owner's Mac,
-- Google Drive, Dropbox, YouTube, any link). Solo OS keeps a small preview
-- image (at most about 800px, in the private LIBRARY_PREVIEWS R2 bucket), a few
-- lines of metadata and a link or path label pointing back to the original.
-- See LIBRARY.md.
--
-- Additive only: two new tables and one read function. Service role only, like
-- the other owner data; the dashboard reads and writes through /api/library.

-- Refuse schema-name collisions. The migration runner skips already-recorded files.
DO $$ BEGIN
  if to_regclass('public.library_assets') is not null then
    raise exception 'Solo OS: existing library_assets table requires a reviewed adoption; no automatic replacement';
  end if;
  if to_regclass('public.library_sync_runs') is not null then
    raise exception 'Solo OS: existing library_sync_runs table requires a reviewed adoption; no automatic replacement';
  end if;
END $$;

-- ── library_assets ──────────────────────────────────────────────────────────

create table if not exists public.library_assets (
  id              uuid primary key default gen_random_uuid(),
  -- Where the original lives. mac: a folder synced by scripts/library-sync.mjs.
  -- link: any URL added by hand. upload: a preview uploaded from the dashboard.
  source          text not null check (source in ('mac', 'gdrive', 'dropbox', 'youtube', 'link', 'upload')),
  -- Stable id of the original within its source (relative path, file id,
  -- video id, URL). Re-sending the same pair updates the row, never duplicates it.
  source_id       text not null check (length(source_id) between 1 and 1000),
  title           text not null default '' check (length(title) <= 300),
  kind            text not null check (kind in ('image', 'video', 'audio', 'doc')),
  -- How to reach the original: a link, or for files that only exist on one
  -- computer, a human-readable path label ("Mac: Shoots/2026/beach.jpg").
  original_url    text check (original_url is null or (original_url ~ '^https?://' and length(original_url) <= 2000)),
  original_label  text check (original_label is null or length(original_label) <= 1000),
  -- The preview object in R2 (null: no preview yet) and its size, so storage
  -- used is a sum, not a bucket listing.
  preview_key     text check (preview_key is null or length(preview_key) <= 300),
  preview_type    text check (preview_type is null or preview_type in ('image/webp', 'image/jpeg', 'image/png')),
  preview_bytes   integer not null default 0 check (preview_bytes >= 0),
  preview_sha256  text,
  width           integer check (width is null or width > 0),
  height          integer check (height is null or height > 0),
  duration_s      numeric check (duration_s is null or duration_s >= 0),
  tags            text[] not null default '{}',
  collection      text check (collection is null or length(collection) <= 80),
  -- Set when the owner edits tags, collection or hidden in the dashboard. A
  -- later sync then keeps the owner's choices instead of the source's.
  curated_at      timestamptz,
  hidden          boolean not null default false,
  meta            jsonb not null default '{}'::jsonb,
  taken_at        timestamptz,
  added_at        timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (source, source_id)
);

create index if not exists library_assets_added_idx on public.library_assets (added_at desc) where not hidden;
create index if not exists library_assets_collection_idx on public.library_assets (collection) where not hidden;
create index if not exists library_assets_tags_idx on public.library_assets using gin (tags);

drop trigger if exists library_assets_updated_at on public.library_assets;
create trigger library_assets_updated_at before update on public.library_assets
  for each row execute function public.update_updated_at();

alter table public.library_assets enable row level security;
revoke all on public.library_assets from anon, authenticated;
grant all on public.library_assets to service_role;

comment on table public.library_assets is
  'Library index: one row per original (wherever it lives) with a small preview in R2. Originals are never stored here.';

-- ── library_sync_runs ───────────────────────────────────────────────────────
-- One row per sync or import run (Mac folder, YouTube), so Setup can show when
-- each source last ran and how it went.

create table if not exists public.library_sync_runs (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source in ('mac', 'gdrive', 'dropbox', 'youtube', 'link', 'upload')),
  label        text check (label is null or length(label) <= 200),   -- e.g. the folder name, never a full home path
  status       text not null default 'ok' check (status in ('ok', 'partial', 'failed')),
  scanned      integer not null default 0 check (scanned >= 0),
  created      integer not null default 0 check (created >= 0),
  updated      integer not null default 0 check (updated >= 0),
  unchanged    integer not null default 0 check (unchanged >= 0),
  failed       integer not null default 0 check (failed >= 0),
  note         text check (note is null or length(note) <= 1000),
  started_at   timestamptz,
  finished_at  timestamptz not null default now()
);

create index if not exists library_sync_runs_source_idx on public.library_sync_runs (source, finished_at desc);

alter table public.library_sync_runs enable row level security;
revoke all on public.library_sync_runs from anon, authenticated;
grant all on public.library_sync_runs to service_role;

-- ── library_stats() ─────────────────────────────────────────────────────────
-- Counts and preview storage used, for the Library page and Setup.

create or replace function public.library_stats() returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'assets', (select count(*) from library_assets),
    'visible', (select count(*) from library_assets where not hidden),
    'previews', (select count(*) from library_assets where preview_key is not null),
    'preview_bytes', (select coalesce(sum(preview_bytes), 0) from library_assets),
    'by_source', coalesce((select jsonb_object_agg(source, n) from (select source, count(*) as n from library_assets group by source) s), '{}'::jsonb),
    'collections', coalesce((select jsonb_object_agg(collection, n) from (select collection, count(*) as n from library_assets where not hidden and collection is not null group by collection) c), '{}'::jsonb)
  );
$$;
revoke all on function public.library_stats() from public, anon, authenticated;
grant execute on function public.library_stats() to service_role;

notify pgrst, 'reload schema';
