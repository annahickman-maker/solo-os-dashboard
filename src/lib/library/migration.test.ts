/**
 * Migration 023 on a throwaway in-process Postgres (PGlite), with the same
 * Supabase stand-ins as scripts/test-pg-local.mjs. Never touches a real
 * database. Installs every shipped migration through install-db.mjs, and
 * separately applies 023 on top of an installed dashboard through migrate.mjs.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { installDb } from "../../../scripts/install-db.mjs";
import { migrate } from "../../../scripts/migrate.mjs";
import { officialMigrations } from "../../../scripts/lib/migrations.mjs";

const DIR = join(import.meta.dirname, "../../../supabase/migrations");
const PROJECT = "abcdefghijklmnopqrst";
type File = { name: string };

const STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function auth.role() returns text language sql stable as $$ select null::text $$;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
`;

async function fresh() {
  const db = new PGlite({ extensions: { uuid_ossp, pgcrypto } });
  await db.exec(STUBS);
  const query = async (sql: string) => {
    const r = await db.exec(sql);
    return (r.at(-1)?.rows ?? []) as Record<string, unknown>[];
  };
  return { db, query };
}

async function exercise(db: PGlite, query: (sql: string) => Promise<Record<string, unknown>[]>) {
  await db.exec(`insert into public.library_assets (source, source_id, kind, title, original_label, preview_key, preview_type, preview_bytes, tags, collection)
    values ('mac', 'Shoots/a.jpg', 'image', 'a', 'Mac: Shoots/a.jpg', 'library/mac/x.webp', 'image/webp', 1200, '{beach}', 'stills')`);
  await db.exec(`insert into public.library_assets (source, source_id, kind, original_url) values ('youtube', 'vid000001', 'video', 'https://www.youtube.com/watch?v=vid000001')`);
  await assert.rejects(db.exec(`insert into public.library_assets (source, source_id, kind) values ('mac', 'Shoots/a.jpg', 'image')`), /library_assets_source_source_id_key/);
  await assert.rejects(db.exec(`insert into public.library_assets (source, source_id, kind) values ('icloud', 'x', 'image')`), /check/);
  await assert.rejects(db.exec(`insert into public.library_assets (source, source_id, kind) values ('link', 'x', 'gif')`), /check/);
  await assert.rejects(db.exec(`insert into public.library_assets (source, source_id, kind, original_url) values ('link', 'y', 'doc', 'javascript:alert(1)')`), /check/);
  await assert.rejects(db.exec(`insert into public.library_assets (source, source_id, kind, preview_type) values ('upload', 'z', 'image', 'image/svg+xml')`), /check/);
  await db.exec(`insert into public.library_sync_runs (source, label, scanned, created) values ('mac', 'Shoots', 2, 1)`);
  await assert.rejects(db.exec(`insert into public.library_sync_runs (source, scanned) values ('mac', -1)`), /check/);

  const [stats] = await query("select public.library_stats() as s");
  assert.deepEqual(stats.s, { assets: 2, visible: 2, previews: 1, preview_bytes: 1200, by_source: { mac: 1, youtube: 1 }, collections: { stills: 1 } });

  const before = (await query("select updated_at from public.library_assets where source = 'mac'"))[0].updated_at as Date;
  await db.exec("select pg_sleep(0.01); update public.library_assets set hidden = true where source = 'mac'");
  const after = (await query("select updated_at from public.library_assets where source = 'mac'"))[0].updated_at as Date;
  assert.ok(after > before, "updated_at trigger");

  const rls = await query("select relname, relrowsecurity as on from pg_class where relname in ('library_assets', 'library_sync_runs') order by relname");
  assert.deepEqual(rls, [{ relname: "library_assets", on: true }, { relname: "library_sync_runs", on: true }]);
  const grants = await query(`select has_table_privilege('anon', 'public.library_assets', 'SELECT') as anon_read,
    has_table_privilege('authenticated', 'public.library_assets', 'INSERT') as auth_write,
    has_function_privilege('anon', 'public.library_stats()', 'EXECUTE') as anon_stats,
    has_function_privilege('service_role', 'public.library_stats()', 'EXECUTE') as service_stats`);
  assert.deepEqual(grants, [{ anon_read: false, auth_write: false, anon_stats: false, service_stats: true }]);
}

test("every shipped migration except 022 installs into an empty database, 023 included", async () => {
  // PGlite has no pgvector, so 022_memory is left out here. The full 001-023 run,
  // 022 included, is covered against real Postgres by npm run test:db-local.
  const files = (officialMigrations(DIR) as File[]).filter((f) => !f.name.startsWith("022_"));
  assert.ok(files.some((f) => f.name === "023_library.sql"));
  const { db, query } = await fresh();
  const home = mkdtempSync(join(tmpdir(), "solo-os-lib-"));
  try {
    const rows = await installDb({ files, project: PROJECT, receiptsPath: join(home, "r", "p.jsonl"), query, log: () => {} });
    assert.equal(rows.length, files.length);
    await exercise(db, query);
    const { plan } = await migrate({ files, project: PROJECT, query, apply: true });
    assert.equal(plan.pending.length, 0);
  } finally {
    await db.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("023 applies on top of an installed 001-021 dashboard and refuses an existing library table", async () => {
  const files = officialMigrations(DIR) as File[];
  const before = files.filter((f) => f.name < "022");
  assert.equal(before.length, 21);
  const lib = files.filter((f) => f.name === "023_library.sql");
  const { db, query } = await fresh();
  const home = mkdtempSync(join(tmpdir(), "solo-os-lib-"));
  try {
    await installDb({ files: before, project: PROJECT, receiptsPath: join(home, "r", "p.jsonl"), query, log: () => {} });
    await db.exec("insert into public.solo_documents (key, data) values ('focus', '{\"a\":1}')");
    const r = await migrate({ files: [...before, ...lib], project: PROJECT, query, apply: true });
    assert.deepEqual(r.applied, ["023_library.sql"]);
    assert.deepEqual(await query("select data from public.solo_documents"), [{ data: { a: 1 } }], "existing data kept");
    await exercise(db, query);
  } finally {
    await db.close();
    rmSync(home, { recursive: true, force: true });
  }

  const other = await fresh();
  try {
    await other.db.exec("create table public.library_assets (id int)");
    const sql = (lib[0] as File & { sql: string }).sql;
    await assert.rejects(other.db.exec(sql), /reviewed adoption/);
  } finally {
    await other.db.close();
  }
});
