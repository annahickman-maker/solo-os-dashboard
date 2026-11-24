#!/usr/bin/env node
/**
 * install-db.mjs - installs every Solo OS migration into an EMPTY Supabase
 * project, then records them in schema_migrations. See INSTALL.md.
 *
 *   node scripts/install-db.mjs --check
 *   node scripts/install-db.mjs --project-ref <ref> --yes [--direct [--password-stdin]] [--receipts <file>]
 *   node scripts/install-db.mjs --project-ref <ref> --yes --record-only [--receipts <file>]
 *
 * Safety:
 *   - The project must be empty: nothing in the public schema, no users, no
 *     storage buckets. Anything else is an existing database: use migrate.mjs.
 *   - The project ref is read from .env.local and must be repeated with
 *     --project-ref, plus --yes.
 *   - One request per migration file. Each request ends with a select that
 *     echoes a receipt; the file only counts as applied when that exact
 *     receipt comes back. A missing acknowledgement stops the install and is
 *     never replayed automatically.
 *   - Each confirmed file is appended to a receipts file that is created
 *     exclusively (an earlier install's receipts are never overwritten).
 *     Default: ~/.solo-os/receipts/<project-ref>.jsonl (folder mode 0700).
 *   - Only when every file is confirmed is the history written, in one
 *     transaction, and then read back and compared.
 *
 * Transport: the Supabase Management API with a personal access token in
 * SUPABASE_ACCESS_TOKEN (default), or --direct for a Postgres connection with
 * the database password (SUPABASE_DB_PASSWORD, --password-stdin or a prompt).
 *
 * The owner's own migrations (900-999) are not installed by this script.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { describeEnv, loadEnv, repoRoots, REPO_ROOT } from './lib/env.mjs';
import {
  EMPTY_PROJECT_SQL, READ_HISTORY_SQL, installFileSql, installHistorySql, isAck,
  parseReceipts, readMigrations, receiptFor, receiptsComplete, writeGate,
} from './lib/migrations.mjs';
import { openTransport } from './lib/transport.mjs';

export function defaultReceiptsPath(project, home = homedir()) {
  return join(home, '.solo-os', 'receipts', `${project}.jsonl`);
}

/**
 * The install itself. `query(sql)` returns the rows of the last statement.
 * Returns the history rows read back after the write.
 */
export async function installDb({ files, project, receiptsPath, recordOnly = false, query, log = () => {} }) {
  if (!files.length) throw new Error('No migrations to install.');
  let receipts;
  if (recordOnly) {
    receipts = parseReceipts(readFileSync(receiptsPath, 'utf8'));
  } else {
    const [check] = await query(EMPTY_PROJECT_SQL);
    if (check?.empty !== true) {
      throw new Error('This project is not empty (it has tables, users or storage buckets). install-db.mjs only installs into a new project. For an existing database use scripts/migrate.mjs.');
    }
    mkdirSync(dirname(receiptsPath), { recursive: true, mode: 0o700 });
    let fd;
    try {
      fd = openSync(receiptsPath, 'wx', 0o600);
    } catch (e) {
      if (e.code === 'EEXIST') throw new Error(`${receiptsPath} already exists: an earlier install ran against this project. Read INSTALL.md ("If an install stops") before doing anything else.`);
      throw e;
    }
    receipts = [];
    try {
      for (const file of files) {
        const receipt = receiptFor(project, file);
        let rows;
        try {
          rows = await query(installFileSql(file, receipt));
        } catch (cause) {
          throw new Error(`${file.name}: failed or unconfirmed (${cause.message}). Stopped. Do not re-run; see INSTALL.md ("If an install stops").`, { cause });
        }
        if (!isAck(rows, receipt)) {
          throw new Error(`${file.name}: no acknowledgement from the database. Stopped. Do not re-run; see INSTALL.md ("If an install stops").`);
        }
        writeSync(fd, JSON.stringify(receipt) + '\n');
        fsyncSync(fd);
        receipts.push(receipt);
        log(`  applied ${file.name}`);
      }
    } finally {
      closeSync(fd);
    }
  }
  if (!receiptsComplete(files, receipts, project)) {
    throw new Error('The receipts do not cover every migration, in order, for this project. History not written. Stop and review.');
  }
  await query(installHistorySql(files));
  const rows = await query(READ_HISTORY_SQL);
  const expected = files.map(({ name, checksum }) => ({ name, checksum })).sort((a, b) => a.name.localeCompare(b.name));
  const got = rows.map(({ name, checksum }) => ({ name, checksum }));
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    throw new Error('schema_migrations read back differently from what was written. Stop and review before using the dashboard.');
  }
  return got;
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      'project-ref': { type: 'string' }, receipts: { type: 'string' }, yes: { type: 'boolean' },
      direct: { type: 'boolean' }, 'password-stdin': { type: 'boolean' }, 'record-only': { type: 'boolean' },
      check: { type: 'boolean' },
    },
  });
  const { files: all, ignored } = readMigrations(join(REPO_ROOT, 'supabase', 'migrations'));
  const files = all.filter((f) => f.official);
  const own = all.filter((f) => !f.official);
  if (ignored.length) throw new Error(`Unexpected files in supabase/migrations (not named NNN_name.sql): ${ignored.join(', ')}`);
  console.log(`${files.length} Solo OS migrations: ${files[0]?.name} to ${files.at(-1)?.name}`);
  if (own.length) console.log(`Not installed here (your own 900-999 migrations, apply them afterwards): ${own.map((f) => f.name).join(', ')}`);
  if (args.check) return;

  const envFile = loadEnv(repoRoots());
  console.log(`Database: ${describeEnv(envFile)}`);
  const shut = writeGate({ envRef: envFile.ref, projectRef: args['project-ref'], yes: args.yes });
  if (shut) {
    console.error(shut);
    process.exitCode = 2;
    return;
  }
  const project = envFile.ref;
  const receiptsPath = resolve(args.receipts ?? defaultReceiptsPath(project));
  console.log(`Receipts: ${receiptsPath}`);
  const transport = await openTransport(project, args);
  try {
    const rows = await installDb({
      files, project, receiptsPath, recordOnly: args['record-only'], query: transport.query, log: console.log,
    });
    console.log(`Done. ${rows.length} migrations installed and recorded for ${project}.`);
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
