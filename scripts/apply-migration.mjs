#!/usr/bin/env node
/**
 * apply-migration.mjs - applies ONE migration file of your own and records it
 * in schema_migrations, in one transaction.
 *
 *   node scripts/apply-migration.mjs supabase/migrations/901_my_change.sql --project-ref <ref> --yes [--direct [--password-stdin]]
 *
 * Meant for the owner's own migrations, numbered 900-999 (migrate.mjs leaves
 * those alone). Solo OS migrations (001-899) go through migrate.mjs, which
 * checks the whole history first; this script refuses them.
 *
 * The project ref is read from .env.local and must be repeated with
 * --project-ref, plus --yes. A file whose name is already recorded is refused.
 * Transport: Management API with SUPABASE_ACCESS_TOKEN, or --direct with the
 * database password (SUPABASE_DB_PASSWORD, --password-stdin or a prompt).
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { TIMEOUTS } from './lib/db.mjs';
import { describeEnv, loadEnv, repoRoots } from './lib/env.mjs';
import {
  HISTORY_EXISTS_SQL, MIGRATION_FILE, checksum, isAck, isOwnerMigration, literal, receiptFor, updateFileSql, writeGate,
} from './lib/migrations.mjs';
import { openTransport } from './lib/transport.mjs';

export async function applyOne({ file, project, query }) {
  if (!MIGRATION_FILE.test(file.name)) throw new Error(`${file.name} is not named NNN_name.sql.`);
  if (!isOwnerMigration(file.name)) throw new Error(`${file.name} is a Solo OS migration number. Use scripts/migrate.mjs for those; your own files use 900-999.`);
  const [exists] = await query(HISTORY_EXISTS_SQL);
  if (exists?.exists !== true) throw new Error('No schema_migrations table. Install the database first (INSTALL.md).');
  const [already] = await query(`select checksum from public.schema_migrations where name = ${literal(file.name)}`);
  if (already) throw new Error(`${file.name} is already recorded (${already.checksum}). Nothing was changed. Give a new change a new number.`);
  const receipt = receiptFor(project, file);
  let rows;
  try {
    rows = await query(updateFileSql(file, receipt, { lockSeconds: TIMEOUTS.lock, statementSeconds: TIMEOUTS.statement, appliedBy: 'apply-migration' }));
  } catch (cause) {
    await query('rollback').catch(() => {});
    throw new Error(`${file.name} failed and was rolled back: ${cause.message}`, { cause });
  }
  if (!isAck(rows, receipt)) throw new Error(`${file.name}: no acknowledgement from the database. Check schema_migrations before re-running.`);
}

async function main() {
  const { values: args, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'project-ref': { type: 'string' }, yes: { type: 'boolean' },
      direct: { type: 'boolean' }, 'password-stdin': { type: 'boolean' },
    },
  });
  const path = positionals[0];
  if (!path) throw new Error('Usage: node scripts/apply-migration.mjs <9NN_name.sql> --project-ref <ref> --yes [--direct]');
  const sql = readFileSync(path, 'utf8');
  const file = { name: basename(path), sql, checksum: checksum(sql) };

  const envFile = loadEnv(repoRoots());
  console.log(`Database: ${describeEnv(envFile)}`);
  const shut = writeGate({ envRef: envFile.ref, projectRef: args['project-ref'], yes: args.yes });
  if (shut) {
    console.error(shut);
    process.exitCode = 2;
    return;
  }
  const transport = await openTransport(envFile.ref, args);
  try {
    await applyOne({ file, project: envFile.ref, query: transport.query });
    console.log(`Applied and recorded ${file.name}`);
  } finally {
    await transport.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
