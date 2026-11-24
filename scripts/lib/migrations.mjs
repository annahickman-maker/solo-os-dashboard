/**
 * migrations.mjs - the pure half of the database tools. Reads migration files,
 * computes checksums, builds the SQL the tools send, and decides what an update
 * should do. No database access and no network, so it is tested with plain
 * values (scripts/test-db-tools.mjs).
 *
 * Numbering:
 *   001-899  Solo OS migrations, shipped in supabase/migrations
 *   900-999  the owner's own migrations; install-db.mjs and migrate.mjs never
 *            apply, check or rewrite them
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

/** The one migration file name pattern: NNN_name.sql. */
export const MIGRATION_FILE = /^(\d{3})_[a-z0-9_.-]+\.sql$/i;

export const OWNER_RANGE = { from: 900, to: 999 };

export function migrationNumber(name) {
  const m = MIGRATION_FILE.exec(name);
  return m ? Number(m[1]) : null;
}

export function isOwnerMigration(name) {
  const n = migrationNumber(name);
  return n !== null && n >= OWNER_RANGE.from && n <= OWNER_RANGE.to;
}

/** CRLF and a BOM must not change a migration's identity. */
export function normaliseSql(text) {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export function checksum(text) {
  return 'sha256:' + createHash('sha256').update(normaliseSql(text), 'utf8').digest('hex');
}

/** A SQL string literal. */
export function literal(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

/**
 * Every NNN_name.sql in `dir`, sorted, with its checksum. `official` is false
 * for the owner's 900-999 files. `ignored` lists .sql files that do not match
 * the naming pattern.
 */
export function readMigrations(dir) {
  if (!existsSync(dir)) throw new Error(`No migrations folder at ${dir}`);
  const all = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.sql')).sort();
  const files = all.filter((f) => MIGRATION_FILE.test(f)).map((name) => {
    const path = join(dir, name);
    const sql = readFileSync(path, 'utf8');
    return { name, path, sql, checksum: checksum(sql), official: !isOwnerMigration(name) };
  });
  const numbers = new Map();
  for (const f of files) {
    const n = migrationNumber(f.name);
    if (numbers.has(n)) throw new Error(`Two migrations share number ${String(n).padStart(3, '0')}: ${numbers.get(n)} and ${f.name}`);
    numbers.set(n, f.name);
  }
  return { files, ignored: all.filter((f) => !MIGRATION_FILE.test(f)) };
}

/** Only the Solo OS migrations, in order. */
export function officialMigrations(dir) {
  return readMigrations(dir).files.filter((f) => f.official);
}

// ── SQL the tools send ──────────────────────────────────────────────────────

/** Nothing in public, no users, no storage buckets. */
export const EMPTY_PROJECT_SQL = `select not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p','v','m','S','f'))
  and not exists (select 1 from auth.users)
  and not exists (select 1 from storage.buckets) as empty`;

export const HISTORY_EXISTS_SQL = "select to_regclass('public.schema_migrations') is not null as exists";

export const READ_HISTORY_SQL = 'select name, checksum from public.schema_migrations order by name';

/** The receipt a migration request must echo back, as its last result. */
export function receiptFor(project, file) {
  return { project, name: file.name, checksum: file.checksum };
}

function ackSql(receipt) {
  return `select ${literal(JSON.stringify(receipt))}::jsonb as receipt;`;
}

export function isAck(rows, receipt) {
  return isDeepStrictEqual(rows, [{ receipt }]);
}

/**
 * One request for one fresh-install file: the file, then the receipt select.
 * The history is written separately, once every file is confirmed.
 */
export function installFileSql(file, receipt) {
  return `${normaliseSql(file.sql)}\n;\n${ackSql(receipt)}`;
}

/**
 * One request for one update: the file and its history row in a single
 * transaction, with lock and statement timeouts, then the receipt select.
 * The insert fails on a duplicate name, which rolls the file back too.
 */
export function updateFileSql(file, receipt, { lockSeconds = 5, statementSeconds = 60, appliedBy = 'migrate' } = {}) {
  return `begin;
set local lock_timeout = '${Number(lockSeconds)}s';
set local statement_timeout = '${Number(statementSeconds)}s';
${normaliseSql(file.sql)}
;
insert into public.schema_migrations (name, checksum, applied_by) values (${literal(file.name)}, ${literal(file.checksum)}, ${literal(appliedBy)});
commit;
${ackSql(receipt)}`;
}

/**
 * The history write after a fresh install, in one transaction. Refuses when
 * the table holds anything other than these exact rows, so a re-run after a
 * lost acknowledgement is safe and a foreign history is never mixed in.
 */
export function installHistorySql(files) {
  if (!files.length) throw new Error('No migrations to record.');
  const rows = files.map((f) => `(${literal(f.name)}, ${literal(f.checksum)})`).join(',\n  ');
  return `begin;
lock table public.schema_migrations in exclusive mode;
do $history$
begin
  if exists (
    select 1 from public.schema_migrations h
    left join (values
  ${rows}) expected(name, checksum) using (name)
    where expected.name is null or h.checksum is distinct from expected.checksum
  ) then raise exception 'schema_migrations already holds a different history. Stop and review.'; end if;
end
$history$;
insert into public.schema_migrations (name, checksum, applied_by)
select name, checksum, 'install-db' from (values
  ${rows}) expected(name, checksum)
on conflict (name) do nothing;
commit;`;
}

// ── Install receipts ────────────────────────────────────────────────────────

/** True when `receipts` are exactly one per file, in order, for this project. */
export function receiptsComplete(files, receipts, project) {
  return isDeepStrictEqual(receipts, files.map((f) => receiptFor(project, f)));
}

export function parseReceipts(text) {
  return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// ── Update planning ─────────────────────────────────────────────────────────

/**
 * Compares the Solo OS files with the recorded history (owner 900-999 rows and
 * files are left out on both sides).
 *
 *   applied    recorded, checksum matches
 *   mismatch   recorded, but the file changed since it was applied
 *   unknown    recorded, but no such file here (this checkout is older than the database)
 *   pending    file here, not recorded
 *   outOfOrder pending files numbered below the newest applied one
 *
 * `ok` is false when anything but plain pending work is found; nothing should
 * be applied then.
 */
export function planUpdate(files, history) {
  const official = files.filter((f) => f.official);
  const rows = history.filter((r) => !isOwnerMigration(r.name));
  const byName = new Map(rows.map((r) => [r.name, r]));
  const fileNames = new Set(official.map((f) => f.name));
  const applied = [];
  const mismatch = [];
  const pending = [];
  for (const f of official) {
    const row = byName.get(f.name);
    if (!row) pending.push(f);
    else if (row.checksum === f.checksum) applied.push(f);
    else mismatch.push({ name: f.name, recorded: row.checksum ?? null, file: f.checksum });
  }
  const unknown = rows.filter((r) => !fileNames.has(r.name)).map((r) => r.name);
  const newest = Math.max(0, ...applied.map((f) => migrationNumber(f.name)), ...mismatch.map((m) => migrationNumber(m.name)));
  const outOfOrder = pending.filter((f) => migrationNumber(f.name) < newest).map((f) => f.name);
  return { applied, mismatch, unknown, pending, outOfOrder, ok: !mismatch.length && !unknown.length && !outOfOrder.length };
}

// ── Confirming the target project ───────────────────────────────────────────

export const PROJECT_REF = /^[a-z0-9]{20}$/;

/**
 * The gate before anything writes. The ref comes from .env.local; the caller
 * must say it back with --project-ref and pass --yes. Returns null when the
 * gate is open, or the reason it is shut.
 */
export function writeGate({ envRef, projectRef, yes }) {
  if (!envRef) return 'Could not read the Supabase project ref from .env.local (SUPABASE_URL).';
  if (!projectRef) return `This writes to Supabase project "${envRef}". Check it is yours, then re-run with --project-ref ${envRef} --yes.`;
  if (!PROJECT_REF.test(projectRef)) return `--project-ref ${projectRef} is not a Supabase project ref (20 lowercase letters and digits).`;
  if (projectRef !== envRef) return `--project-ref ${projectRef} does not match the project in .env.local ("${envRef}"). Nothing was changed.`;
  if (yes !== true) return `Project "${envRef}" confirmed. Re-run with --yes as well to write.`;
  return null;
}
