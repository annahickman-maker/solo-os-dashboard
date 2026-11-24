#!/usr/bin/env node
/**
 * migrate.mjs - brings an installed Solo OS database up to the migrations in
 * this checkout. See UPDATE.md.
 *
 *   node scripts/migrate.mjs [--direct [--password-stdin]]
 *       lists what is applied and what is pending. Read-only.
 *   node scripts/migrate.mjs --project-ref <ref> --yes [--direct [--password-stdin]]
 *       applies the pending migrations, in order.
 *
 * Before anything is applied it checks the recorded history against the
 * files: every applied migration's checksum must match its file, every
 * recorded migration must have a file here, and no pending file may be
 * numbered below one that is already applied. Any of those stops it.
 *
 * Each pending migration goes in one request: the file and its
 * schema_migrations row in one transaction, then a receipt select. It stops at
 * the first failure or missing acknowledgement.
 *
 * The owner's own migrations (900-999) are left alone: never applied,
 * checked or reported as unknown.
 *
 * Transport: the Supabase Management API with SUPABASE_ACCESS_TOKEN
 * (default), or --direct with the database password.
 */
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { TIMEOUTS } from './lib/db.mjs';
import { describeEnv, loadEnv, repoRoots, REPO_ROOT } from './lib/env.mjs';
import {
  HISTORY_EXISTS_SQL, READ_HISTORY_SQL, isAck, literal, planUpdate, readMigrations, receiptFor,
  updateFileSql, writeGate,
} from './lib/migrations.mjs';
import { openTransport } from './lib/transport.mjs';

export class StopError extends Error {}

/** Lists, checks and (with apply) applies. Returns the plan and what was applied. */
export async function migrate({ files, project, query, apply = false, log = () => {}, timeouts = TIMEOUTS }) {
  const [exists] = await query(HISTORY_EXISTS_SQL);
  if (exists?.exists !== true) {
    throw new StopError('This database has no schema_migrations table, so it was not installed with scripts/install-db.mjs. Nothing was changed.');
  }
  const history = await query(READ_HISTORY_SQL);
  const plan = planUpdate(files, history);

  log(`${plan.applied.length} applied, ${plan.pending.length} pending.`);
  for (const f of plan.pending) log(`  pending  ${f.name}`);
  for (const m of plan.mismatch) log(`  CHANGED  ${m.name}: recorded ${m.recorded}, file ${m.file}`);
  for (const n of plan.unknown) log(`  UNKNOWN  ${n}: recorded in the database but not in this checkout`);
  for (const n of plan.outOfOrder) log(`  ORDER    ${n}: pending, but a later migration is already applied`);

  if (!plan.ok) {
    throw new StopError('Stopped before applying anything: the history and the files disagree (see the lines above and UPDATE.md, "When migrate stops").');
  }
  const applied = [];
  if (!apply || !plan.pending.length) return { plan, applied };

  for (const file of plan.pending) {
    const receipt = receiptFor(project, file);
    let rows;
    try {
      rows = await query(updateFileSql(file, receipt, { lockSeconds: timeouts.lock, statementSeconds: timeouts.statement }));
    } catch (cause) {
      // A direct connection keeps an aborted transaction open until told otherwise.
      await query('rollback').catch(() => {});
      throw new Error(`${file.name} failed and was rolled back: ${cause.message}. Nothing after it was applied.`, { cause });
    }
    if (!isAck(rows, receipt)) {
      throw new Error(`${file.name}: no acknowledgement from the database. Run migrate.mjs again without --yes to see whether it was recorded before doing anything else.`);
    }
    const [row] = await query(`select checksum from public.schema_migrations where name = ${literal(file.name)}`);
    if (row?.checksum !== file.checksum) throw new Error(`${file.name}: history row did not read back. Stop and review.`);
    applied.push(file.name);
    log(`  applied  ${file.name}`);
  }
  return { plan, applied };
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      'project-ref': { type: 'string' }, yes: { type: 'boolean' },
      direct: { type: 'boolean' }, 'password-stdin': { type: 'boolean' },
    },
  });
  const { files, ignored } = readMigrations(join(REPO_ROOT, 'supabase', 'migrations'));
  if (ignored.length) console.log(`Ignored (not named NNN_name.sql): ${ignored.join(', ')}`);
  const envFile = loadEnv(repoRoots());
  console.log(`Database: ${describeEnv(envFile)}`);
  if (!envFile.ref) {
    process.exitCode = 1;
    return;
  }
  const wantsWrite = Boolean(args.yes || args['project-ref']);
  if (wantsWrite) {
    const shut = writeGate({ envRef: envFile.ref, projectRef: args['project-ref'], yes: args.yes });
    if (shut) {
      console.error(shut);
      process.exitCode = 2;
      return;
    }
  }
  const transport = await openTransport(envFile.ref, args);
  try {
    const { plan, applied } = await migrate({ files, project: envFile.ref, query: transport.query, apply: wantsWrite, log: console.log });
    if (!wantsWrite && plan.pending.length) {
      console.log(`To apply: node scripts/migrate.mjs --project-ref ${envFile.ref} --yes${args.direct ? ' --direct' : ''}`);
    } else if (wantsWrite) {
      console.log(applied.length ? `Done. Applied ${applied.length}.` : 'Nothing to apply. The database is up to date.');
    }
  } finally {
    await transport.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = err instanceof StopError ? 2 : 1;
  });
}
