#!/usr/bin/env node
/**
 * test-pg-local.mjs - runs install-db.mjs and migrate.mjs against a throwaway
 * local Postgres, with minimal stand-ins for the Supabase roles, auth schema
 * and storage schema. Never point it at a real project.
 *
 *   PG_TEST_URL=postgres://postgres:pw@127.0.0.1:54329/postgres node --test scripts/test-pg-local.mjs
 *
 * Skipped when PG_TEST_URL is not set. It creates and drops its own databases.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installDb } from './install-db.mjs';
import { migrate } from './migrate.mjs';
import { officialMigrations } from './lib/migrations.mjs';
import { directQuery } from './lib/transport.mjs';

const URL_ = process.env.PG_TEST_URL;
const DIR = new URL('../supabase/migrations', import.meta.url).pathname;

const STUBS = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function auth.role() returns text language sql stable as $$ select null::text $$;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
`;

async function freshDb(pg, name) {
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  await admin.query(`drop database if exists ${name}`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const u = new URL(URL_);
  u.pathname = '/' + name;
  const client = new pg.Client({ connectionString: u.toString() });
  await client.connect();
  await client.query(STUBS);
  return client;
}

test('all migrations install in order into an empty database, then migrate finds nothing to do', { skip: !URL_ && 'PG_TEST_URL not set' }, async () => {
  const pg = (await import('pg')).default;
  const client = await freshDb(pg, 'solo_os_install_test');
  const home = mkdtempSync(join(tmpdir(), 'solo-os-pg-'));
  try {
    const files = officialMigrations(DIR);
    assert.ok(files.some((f) => f.name === '023_library.sql'));
    const query = directQuery(client);
    const project = 'abcdefghijklmnopqrst';
    const applied = [];
    const rows = await installDb({ files, project, receiptsPath: join(home, 'r', 'p.jsonl'), query, log: (l) => applied.push(l) });
    assert.equal(rows.length, files.length);
    assert.equal(applied.length, files.length);
    const tables = await query("select count(*)::int as n from information_schema.tables where table_schema = 'public'");
    assert.ok(tables[0].n > 40, `only ${tables[0].n} public tables`);
    // 021: digital products and one delivery per order.
    await client.query("insert into public.products (slug, name, kind, amount_minor, currency, delivery_url) values ('guide', 'Guide', 'digital', 2900, 'AUD', 'https://files.example.com/g.pdf')");
    await assert.rejects(client.query("insert into public.products (slug, name, kind, amount_minor, currency) values ('bad', 'Bad', 'gift', 100, 'AUD')"), /products_kind_check/);
    await assert.rejects(client.query("insert into public.products (slug, name, kind, amount_minor, currency, delivery_url) values ('bad2', 'Bad', 'digital', 100, 'AUD', 'http://x.example.com')"), /products_delivery_url_https/);
    const [order] = (await client.query("insert into public.orders (currency, status) values ('AUD', 'paid') returning id")).rows;
    await client.query('insert into public.order_deliveries (order_id) values ($1)', [order.id]);
    await assert.rejects(client.query('insert into public.order_deliveries (order_id) values ($1)', [order.id]), /order_deliveries_pkey/);
    const kinds = await query("select count(*)::int as n from pg_constraint where conrelid = 'public.products'::regclass and conname = 'products_kind_check'");
    assert.deepEqual(kinds, [{ n: 1 }]);
    const { plan } = await migrate({ files, project, query, apply: true });
    assert.equal(plan.pending.length, 0);
    assert.ok(plan.ok);

    // An update: one new file is applied and recorded; a changed file stops it.
    const extra = { name: '098_extra.sql', sql: 'create table public.extra_t (id int);', checksum: 'sha256:x', official: true };
    const r = await migrate({ files: [...files, extra], project, query, apply: true });
    assert.deepEqual(r.applied, ['098_extra.sql']);
    const failing = { name: '099_bad.sql', sql: 'create table public.bad_t (id int); select 1/0;', checksum: 'sha256:y', official: true };
    await assert.rejects(migrate({ files: [...files, extra, failing], project, query, apply: true }), /099_bad\.sql failed and was rolled back/);
    const bad = await query("select to_regclass('public.bad_t') is null as gone, (select count(*)::int from schema_migrations where name = '099_bad.sql') as n");
    assert.deepEqual(bad, [{ gone: true, n: 0 }]);
  } finally {
    await client.end();
    rmSync(home, { recursive: true, force: true });
  }
});

test('021 applies on top of an installed 001-020 dashboard and keeps its products', { skip: !URL_ && 'PG_TEST_URL not set' }, async () => {
  const pg = (await import('pg')).default;
  const client = await freshDb(pg, 'solo_os_upgrade_021_test');
  const home = mkdtempSync(join(tmpdir(), 'solo-os-pg-'));
  try {
    const files = officialMigrations(DIR);
    const before = files.filter((f) => f.name < '021');
    assert.equal(before.length, 20);
    const query = directQuery(client);
    const project = 'abcdefghijklmnopqrst';
    await installDb({ files: before, project, receiptsPath: join(home, 'r', 'p.jsonl'), query, log: () => {} });
    await client.query("insert into public.products (slug, name, kind, amount_minor, currency) values ('call', 'Call', 'one_time', 4900, 'AUD')");
    await assert.rejects(client.query("insert into public.products (slug, name, kind, amount_minor, currency) values ('early', 'Early', 'digital', 100, 'AUD')"), /check/);

    const upTo021 = files.filter((f) => f.name < '022');
    const r = await migrate({ files: upTo021, project, query, apply: true });
    assert.deepEqual(r.applied, ['021_digital_delivery.sql']);
    const kept = await query("select slug, kind, delivery_url from public.products");
    assert.deepEqual(kept, [{ slug: 'call', kind: 'one_time', delivery_url: null }]);
    await client.query("insert into public.products (slug, name, kind, amount_minor, currency, delivery_url) values ('guide', 'Guide', 'digital', 2900, 'AUD', 'https://files.example.com/g.pdf')");
    const rls = await query("select relrowsecurity as on from pg_class where oid = 'public.order_deliveries'::regclass");
    assert.deepEqual(rls, [{ on: true }]);
    const { plan } = await migrate({ files: upTo021, project, query, apply: true });
    assert.equal(plan.pending.length, 0);
  } finally {
    await client.end();
    rmSync(home, { recursive: true, force: true });
  }
});

/** A 384-dimension unit vector pointing mostly along `axis`. */
const vec = (axis, wobble = 0) => '[' + Array.from({ length: 384 }, (_, i) => (i === axis ? 1 : i === (axis + 1) % 384 ? wobble : 0)).join(',') + ']';

test('022 applies on top of an installed 001-021 dashboard; memory search ranks by keywords and by meaning', { skip: !URL_ && 'PG_TEST_URL not set' }, async () => {
  const pg = (await import('pg')).default;
  const client = await freshDb(pg, 'solo_os_upgrade_022_test');
  const home = mkdtempSync(join(tmpdir(), 'solo-os-pg-'));
  try {
    const files = officialMigrations(DIR);
    const before = files.filter((f) => f.name < '022');
    assert.equal(before.length, 21);
    const query = directQuery(client);
    const project = 'abcdefghijklmnopqrst';
    await installDb({ files: before, project, receiptsPath: join(home, 'r', 'p.jsonl'), query, log: () => {} });
    await client.query("insert into public.products (slug, name, kind, amount_minor, currency) values ('call', 'Call', 'one_time', 4900, 'AUD')");

    const upTo022 = files.filter((f) => f.name < '023');
    const r = await migrate({ files: upTo022, project, query, apply: true });
    assert.deepEqual(r.applied, ['022_memory.sql']);
    assert.deepEqual(await query('select slug from public.products'), [{ slug: 'call' }]);
    const rls = await query("select relname, relrowsecurity as on from pg_class where relname in ('memory_documents', 'memory_chunks') order by relname");
    assert.deepEqual(rls, [{ relname: 'memory_chunks', on: true }, { relname: 'memory_documents', on: true }]);

    // (source, source_id) is unique; the checks refuse bad values.
    const doc = async (source, sourceId, title, kind = 'note') =>
      (await client.query('insert into public.memory_documents (source, source_id, title, kind, raw_text) values ($1, $2, $3, $4, $5) returning id', [source, sourceId, title, kind, 'x'])).rows[0].id;
    const a = await doc('zoom', 'rec-1', 'Pricing call', 'conversation');
    const b = await doc('folder', 'notes/tea.md', 'Tea notes');
    await doc('zoom', 'rec-2', 'Other call', 'conversation');
    await assert.rejects(doc('zoom', 'rec-1', 'Again'), /memory_documents_source_key/);
    await assert.rejects(doc('Bad Source', 'x', 'Bad'), /memory_documents_source_check/);
    await assert.rejects(doc('zoom', 'rec-9', 'Bad', 'gossip'), /memory_documents_kind_check/);

    const chunk = (d, i, content, embedding = null) =>
      client.query('insert into public.memory_chunks (document_id, chunk_index, content, embedding) values ($1, $2, $3, $4)', [d, i, content, embedding]);
    await chunk(a, 0, 'We talked about the weather and the weekend.');
    await chunk(a, 1, 'My pricing rule: raise prices every time the calendar is full, and price the outcome, not the hours.');
    await chunk(b, 0, 'Green tea, oolong and the right water temperature. Pricing is not mentioned much.');
    await assert.rejects(chunk(a, 1, 'duplicate'), /memory_chunks_document_index_key/);

    // Keywords only (no embedding): OR between words, more matches rank first.
    const kw = await query("select title, chunk_index, matched from public.memory_search('how should I think about pricing and raising prices?', null, 5, null)");
    assert.deepEqual(kw.map((x) => [x.title, x.chunk_index, x.matched]), [['Pricing call', 1, 'keywords'], ['Tea notes', 0, 'keywords']]);
    const filtered = await query("select title from public.memory_search('pricing', null, 5, 'note')");
    assert.deepEqual(filtered, [{ title: 'Tea notes' }]);
    assert.deepEqual(await query("select count(*)::int as n from public.memory_search('the of and', null, 5, null)"), [{ n: 0 }]);

    // Backfill embeddings, then a meaning match wins without sharing a word.
    const ids = (await client.query('select id, document_id, chunk_index from public.memory_chunks order by document_id, chunk_index')).rows;
    const items = ids.map((c, i) => ({ id: c.id, embedding: vec(i * 10) }));
    assert.deepEqual(await query(`select public.memory_set_embeddings('${JSON.stringify(items)}'::jsonb) as n`), [{ n: 3 }]);
    const sem = await query(`select chunk_index, matched from public.memory_search('oolong', '${vec(20, 0.1)}', 2, null)`);
    assert.deepEqual(sem[0], { chunk_index: 0, matched: 'both' });
    const meaningOnly = await query(`select content from public.memory_search('zzz', '${vec(0, 0.1)}', 1, null)`);
    assert.equal(meaningOnly.length, 1);
    const status = await query('select documents::int, chunks::int, embedded::int, last_import_at is not null as recent from public.memory_status()');
    assert.deepEqual(status, [{ documents: 3, chunks: 3, embedded: 3, recent: true }]);

    // Deleting a document removes its chunks.
    await client.query('delete from public.memory_documents where id = $1', [a]);
    assert.deepEqual(await query('select count(*)::int as n from public.memory_chunks'), [{ n: 1 }]);
    const { plan } = await migrate({ files: upTo022, project, query, apply: true });
    assert.equal(plan.pending.length, 0);
  } finally {
    await client.end();
    rmSync(home, { recursive: true, force: true });
  }
});
