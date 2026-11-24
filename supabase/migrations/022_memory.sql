-- Refuse schema-name collisions. The migration runner skips already-recorded files.
DO $$ BEGIN
  if to_regclass('public.memory_documents') is not null or to_regclass('public.memory_chunks') is not null then
    raise exception 'Solo OS: existing memory_documents or memory_chunks table requires a reviewed adoption; no automatic replacement';
  end if;
END $$;

-- Memory: the owner's own words, searchable (see MEMORY.md).
--
-- Additive only:
-- - memory_documents: one row per transcript, note or content piece. A
--   document is identified by (source, source_id), so importing the same
--   recording, file or video twice updates the row instead of adding another.
--   content_hash says whether the text changed.
-- - memory_chunks: the document cut into passages, each with an optional
--   384-dimension embedding (Workers AI @cf/baai/bge-small-en-v1.5) and a
--   full-text index. A chunk without an embedding is still found by keywords.
-- - memory_search: meaning (vector) and keywords (full text), merged by
--   reciprocal rank. Called with no embedding it is keyword search only.
-- - memory_set_embeddings / memory_status: the backfill and the Setup card.
-- Service role only, like the other private tables.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- ── memory_documents ────────────────────────────────────────────────────────

create table if not exists public.memory_documents (
  id            uuid primary key default gen_random_uuid(),
  -- Where it came from: upload, paste, inbox, zoom, drive, youtube, folder, agent, ...
  source        text not null check (source ~ '^[a-z0-9][a-z0-9_.:-]{0,63}$'),
  -- The source's own id: a recording id, a file path, a video id. Unique per source.
  source_id     text not null check (length(source_id) between 1 and 500),
  title         text not null check (length(title) between 1 and 300),
  kind          text not null default 'note' check (kind in ('conversation', 'content', 'note')),
  occurred_at   timestamptz,               -- when it was said or published, if known
  url           text check (url is null or (url ~ '^https?://' and length(url) <= 2000)),
  -- Optional speaker information: the labels found in the transcript, and
  -- which of them is the owner (so answers can tell their words from others').
  speakers      text[] not null default '{}',
  owner_speaker text check (owner_speaker is null or length(owner_speaker) <= 200),
  raw_text      text not null,
  content_hash  text not null default '', -- sha256 of the stored text; '' until the chunks are written
  bytes         integer not null default 0 check (bytes >= 0),
  chunk_count   integer not null default 0 check (chunk_count >= 0),
  added_by      text,                      -- 'owner', 'inbox' or an agent key name
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint memory_documents_source_key unique (source, source_id)
);

create index if not exists memory_documents_occurred_idx on public.memory_documents (occurred_at desc nulls last, created_at desc);
create index if not exists memory_documents_kind_idx on public.memory_documents (kind);
create index if not exists memory_documents_updated_idx on public.memory_documents (updated_at desc);

drop trigger if exists memory_documents_updated_at on public.memory_documents;
create trigger memory_documents_updated_at before update on public.memory_documents
  for each row execute function public.update_updated_at();

-- ── memory_chunks ───────────────────────────────────────────────────────────

create table if not exists public.memory_chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.memory_documents(id) on delete cascade,
  chunk_index  integer not null check (chunk_index >= 0),
  content      text not null,
  embedding    extensions.vector(384),
  fts          tsvector generated always as (to_tsvector('english', content)) stored,
  constraint memory_chunks_document_index_key unique (document_id, chunk_index)
);

create index if not exists memory_chunks_fts_idx on public.memory_chunks using gin (fts);
create index if not exists memory_chunks_embedding_idx on public.memory_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists memory_chunks_missing_idx on public.memory_chunks (document_id) where embedding is null;

alter table public.memory_documents enable row level security;
alter table public.memory_chunks enable row level security;
revoke all on public.memory_documents, public.memory_chunks from anon, authenticated;
grant all on public.memory_documents, public.memory_chunks to service_role;

-- ── memory_search ───────────────────────────────────────────────────────────
-- Keywords use OR between the question's words (a question rarely repeats
-- every word of the passage that answers it); ts_rank_cd rewards passages
-- that match more of them.

create or replace function public.memory_search(
  query_text text,
  query_embedding extensions.vector(384) default null,
  match_count integer default 12,
  kind_filter text default null
) returns table (
  document_id uuid, title text, kind text, source text, occurred_at timestamptz, url text,
  owner_speaker text, chunk_index integer, content text, score double precision, matched text
)
language sql stable security invoker set search_path = public, extensions as $$
  with q as (
    select nullif(replace(plainto_tsquery('english', coalesce(query_text, ''))::text, ' & ', ' | '), '')::tsquery as tsq
  ), sem as (
    select c.id, row_number() over (order by c.embedding <=> query_embedding) as rnk
    from memory_chunks c join memory_documents d on d.id = c.document_id
    where query_embedding is not null and c.embedding is not null
      and (kind_filter is null or d.kind = kind_filter)
    order by c.embedding <=> query_embedding limit 40
  ), kw as (
    select c.id, row_number() over (order by ts_rank_cd(c.fts, q.tsq) desc, c.chunk_index) as rnk
    from memory_chunks c join memory_documents d on d.id = c.document_id, q
    where q.tsq is not null and c.fts @@ q.tsq
      and (kind_filter is null or d.kind = kind_filter)
    order by ts_rank_cd(c.fts, q.tsq) desc, c.chunk_index limit 40
  ), merged as (
    select coalesce(sem.id, kw.id) as id,
           coalesce(1.0 / (60 + sem.rnk), 0) + coalesce(1.0 / (60 + kw.rnk), 0) as score,
           case when sem.id is not null and kw.id is not null then 'both'
                when sem.id is not null then 'meaning' else 'keywords' end as matched
    from sem full outer join kw on sem.id = kw.id
  )
  select d.id, d.title, d.kind, d.source, d.occurred_at, d.url, d.owner_speaker,
         c.chunk_index, c.content, m.score::double precision, m.matched
  from merged m join memory_chunks c on c.id = m.id join memory_documents d on d.id = c.document_id
  order by m.score desc, d.occurred_at desc nulls last, c.chunk_index
  limit greatest(1, least(coalesce(match_count, 12), 50));
$$;

-- ── memory_set_embeddings ───────────────────────────────────────────────────
-- items: [{"id": "<chunk uuid>", "embedding": "[0.1,...]"}, ...]. One call per batch.

create or replace function public.memory_set_embeddings(items jsonb)
returns integer
language sql volatile security invoker set search_path = public, extensions as $$
  with input as (
    select (e->>'id')::uuid as id, (e->>'embedding')::extensions.vector(384) as embedding
    from jsonb_array_elements(coalesce(items, '[]'::jsonb)) e
  ), changed as (
    update memory_chunks c set embedding = i.embedding from input i where c.id = i.id returning 1
  )
  select count(*)::integer from changed;
$$;

-- ── memory_status ───────────────────────────────────────────────────────────

create or replace function public.memory_status()
returns table (documents bigint, chunks bigint, embedded bigint, last_import_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select (select count(*) from memory_documents),
         (select count(*) from memory_chunks),
         (select count(*) from memory_chunks where embedding is not null),
         (select max(updated_at) from memory_documents);
$$;

revoke all on function public.memory_search(text, extensions.vector, integer, text) from public, anon, authenticated;
grant execute on function public.memory_search(text, extensions.vector, integer, text) to service_role;
revoke all on function public.memory_set_embeddings(jsonb) from public, anon, authenticated;
grant execute on function public.memory_set_embeddings(jsonb) to service_role;
revoke all on function public.memory_status() from public, anon, authenticated;
grant execute on function public.memory_status() to service_role;

comment on table public.memory_documents is
  'Memory: the owner''s transcripts, notes and content, one row per (source, source_id). Service role only.';
comment on table public.memory_chunks is
  'Memory passages with optional bge-small-en-v1.5 embeddings (384) and a full-text index.';

notify pgrst, 'reload schema';
