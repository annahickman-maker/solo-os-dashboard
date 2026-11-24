/**
 * test-db-tools.mjs - install-db.mjs, migrate.mjs and their libraries, with a
 * fake query function. No network and no database.
 *
 *   node --test scripts/test-db-tools.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultReceiptsPath, installDb } from './install-db.mjs';
import { migrate, StopError } from './migrate.mjs';
import { BUNDLED_CA } from './lib/db.mjs';
import {
  checksum, isOwnerMigration, officialMigrations, planUpdate, readMigrations, receiptFor, writeGate,
} from './lib/migrations.mjs';
import { managementQuery } from './lib/transport.mjs';

const PROJECT = 'abcdefghijklmnopqrst';
const REPO_MIGRATIONS = new URL('../supabase/migrations', import.meta.url).pathname;

function tmp() {
  return mkdtempSync(join(tmpdir(), 'solo-os-db-test-'));
}

function file(name, sql = `create table t_${name.slice(0, 3)} (id int);`) {
  return { name, sql, checksum: checksum(sql), official: !isOwnerMigration(name) };
}

const FILES = [file('001_a.sql'), file('002_b.sql'), file('003_c.sql')];

/**
 * A fake database. It acknowledges migration requests by echoing the receipt
 * found in the SQL, keeps a history table, and records every request.
 */
function fakeDb({ empty = true, history = null, failOn = null, dropAckOn = null, readbackOverride = null } = {}) {
  const sent = [];
  const state = { history: history ? [...history] : null };
  const query = async (sql) => {
    sent.push(sql);
    if (sql.includes('not exists (select 1 from auth.users)')) return [{ empty }];
    if (sql.startsWith("select to_regclass('public.schema_migrations')")) return [{ exists: state.history !== null }];
    if (sql.startsWith('select name, checksum from public.schema_migrations')) {
      return readbackOverride ?? [...(state.history ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    }
    if (sql.startsWith('select checksum from public.schema_migrations where name')) {
      const name = /name = '([^']+)'/.exec(sql)[1];
      return state.history.filter((r) => r.name === name).map((r) => ({ checksum: r.checksum }));
    }
    if (sql.includes("'install-db' from (values")) {
      state.history ??= [];
      for (const [, name, sum] of sql.split('insert into')[1].matchAll(/\('([^']+)', '([^']+)'\)/g)) {
        if (!state.history.some((r) => r.name === name)) state.history.push({ name, checksum: sum });
      }
      return [];
    }
    if (sql === 'rollback') return [];
    const m = /select '(\{.*\})'::jsonb as receipt;$/.exec(sql);
    if (m) {
      const receipt = JSON.parse(m[1].replaceAll("''", "'"));
      if (failOn === receipt.name) throw new Error('boom');
      if (/'(migrate|apply-migration)'\);/.test(sql)) {
        state.history ??= [];
        state.history.push({ name: receipt.name, checksum: receipt.checksum });
      }
      if (dropAckOn === receipt.name) return [];
      return [{ receipt }];
    }
    throw new Error('fake db: unexpected SQL ' + sql.slice(0, 80));
  };
  return { query, sent, state };
}

const migrationRequests = (sent) => sent.filter((s) => s.includes('::jsonb as receipt;'));

// ── Files and checksums ─────────────────────────────────────────────────────

test('the shipped migrations are 001-023, unique, all official', () => {
  const files = officialMigrations(REPO_MIGRATIONS);
  assert.equal(files.length, 23);
  assert.deepEqual(files.map((f) => f.name.slice(0, 3)), Array.from({ length: 23 }, (_, i) => String(i + 1).padStart(3, '0')));
  assert.equal(files[0].name, '001_visitors.sql');
  assert.equal(files[13].name, '014_schema_migrations.sql');
});

test('readMigrations sorts, flags owner 900-999 files, lists odd names and refuses duplicate numbers', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, '002_b.sql'), 'select 2;');
    writeFileSync(join(dir, '001_a.sql'), 'select 1;');
    writeFileSync(join(dir, '901_mine.sql'), 'select 9;');
    writeFileSync(join(dir, 'notes.sql'), '');
    const { files, ignored } = readMigrations(dir);
    assert.deepEqual(files.map((f) => [f.name, f.official]), [['001_a.sql', true], ['002_b.sql', true], ['901_mine.sql', false]]);
    assert.deepEqual(ignored, ['notes.sql']);
    writeFileSync(join(dir, '002_again.sql'), 'select 3;');
    assert.throws(() => readMigrations(dir), /share number 002/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checksums ignore CRLF and a BOM but nothing else', () => {
  assert.equal(checksum('a\r\nb'), checksum('a\nb'));
  assert.equal(checksum('﻿a'), checksum('a'));
  assert.notEqual(checksum('a '), checksum('a'));
  assert.match(checksum('x'), /^sha256:[0-9a-f]{64}$/);
});

test('writeGate needs the matching ref and --yes', () => {
  assert.match(writeGate({ envRef: null }), /SUPABASE_URL/);
  assert.match(writeGate({ envRef: PROJECT }), /--project-ref abcdefghijklmnopqrst --yes/);
  assert.match(writeGate({ envRef: PROJECT, projectRef: 'zzzzzzzzzzzzzzzzzzzz', yes: true }), /does not match/);
  assert.match(writeGate({ envRef: PROJECT, projectRef: 'short', yes: true }), /not a Supabase project ref/);
  assert.match(writeGate({ envRef: PROJECT, projectRef: PROJECT }), /--yes/);
  assert.equal(writeGate({ envRef: PROJECT, projectRef: PROJECT, yes: true }), null);
});

// ── install-db ──────────────────────────────────────────────────────────────

test('install: one request per file in order, receipts written, history written and read back', async () => {
  const dir = tmp();
  try {
    const receiptsPath = join(dir, 'receipts', `${PROJECT}.jsonl`);
    const db = fakeDb();
    const rows = await installDb({ files: FILES, project: PROJECT, receiptsPath, query: db.query });
    assert.deepEqual(rows, FILES.map(({ name, checksum: c }) => ({ name, checksum: c })));
    const reqs = migrationRequests(db.sent);
    assert.equal(reqs.length, 3);
    FILES.forEach((f, i) => assert.ok(reqs[i].startsWith(f.sql)));
    assert.deepEqual(readFileSync(receiptsPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l)), FILES.map((f) => receiptFor(PROJECT, f)));
    assert.equal(statSync(join(dir, 'receipts')).mode & 0o777, 0o700);
    assert.equal(statSync(receiptsPath).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install refuses an occupied project before creating receipts', async () => {
  const dir = tmp();
  try {
    const receiptsPath = join(dir, 'r.jsonl');
    const db = fakeDb({ empty: false });
    await assert.rejects(installDb({ files: FILES, project: PROJECT, receiptsPath, query: db.query }), /not empty/);
    assert.equal(existsSync(receiptsPath), false);
    assert.equal(migrationRequests(db.sent).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install never overwrites an earlier receipts file', async () => {
  const dir = tmp();
  try {
    const receiptsPath = join(dir, 'r.jsonl');
    writeFileSync(receiptsPath, 'earlier\n');
    const db = fakeDb();
    await assert.rejects(installDb({ files: FILES, project: PROJECT, receiptsPath, query: db.query }), /already exists/);
    assert.equal(readFileSync(receiptsPath, 'utf8'), 'earlier\n');
    assert.equal(migrationRequests(db.sent).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install stops at a missing acknowledgement, keeps earlier receipts, writes no history', async () => {
  const dir = tmp();
  try {
    const receiptsPath = join(dir, 'r.jsonl');
    const db = fakeDb({ dropAckOn: '002_b.sql' });
    await assert.rejects(installDb({ files: FILES, project: PROJECT, receiptsPath, query: db.query }), /002_b\.sql: no acknowledgement/);
    assert.equal(migrationRequests(db.sent).length, 2);
    assert.equal(readFileSync(receiptsPath, 'utf8').trim().split('\n').length, 1);
    assert.equal(db.state.history, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install stops at a failed request and never replays it', async () => {
  const dir = tmp();
  try {
    const db = fakeDb({ failOn: '001_a.sql' });
    await assert.rejects(installDb({ files: FILES, project: PROJECT, receiptsPath: join(dir, 'r.jsonl'), query: db.query }), /001_a\.sql: failed or unconfirmed/);
    assert.equal(migrationRequests(db.sent).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install fails when the history reads back differently', async () => {
  const dir = tmp();
  try {
    const db = fakeDb({ readbackOverride: [{ name: '001_a.sql', checksum: 'sha256:other' }] });
    await assert.rejects(installDb({ files: FILES, project: PROJECT, receiptsPath: join(dir, 'r.jsonl'), query: db.query }), /read back differently/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--record-only writes history from complete receipts without sending any migration', async () => {
  const dir = tmp();
  try {
    const receiptsPath = join(dir, 'r.jsonl');
    writeFileSync(receiptsPath, FILES.map((f) => JSON.stringify(receiptFor(PROJECT, f))).join('\n') + '\n');
    const db = fakeDb();
    const rows = await installDb({ files: FILES, project: PROJECT, receiptsPath, recordOnly: true, query: db.query });
    assert.equal(rows.length, 3);
    assert.equal(migrationRequests(db.sent).length, 0);

    writeFileSync(receiptsPath, JSON.stringify(receiptFor(PROJECT, FILES[0])) + '\n');
    await assert.rejects(installDb({ files: FILES, project: PROJECT, receiptsPath, recordOnly: true, query: fakeDb().query }), /do not cover every migration/);
    writeFileSync(receiptsPath, FILES.map((f) => JSON.stringify(receiptFor('zzzzzzzzzzzzzzzzzzzz', f))).join('\n'));
    await assert.rejects(installDb({ files: FILES, project: PROJECT, receiptsPath, recordOnly: true, query: fakeDb().query }), /do not cover every migration/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('receipts default to ~/.solo-os/receipts/<ref>.jsonl', () => {
  assert.equal(defaultReceiptsPath(PROJECT, '/home/x'), `/home/x/.solo-os/receipts/${PROJECT}.jsonl`);
});

// ── migrate ─────────────────────────────────────────────────────────────────

const recorded = (files) => files.map(({ name, checksum: c }) => ({ name, checksum: c }));

test('migrate lists pending without writing', async () => {
  const db = fakeDb({ history: recorded(FILES.slice(0, 1)) });
  const { plan, applied } = await migrate({ files: FILES, project: PROJECT, query: db.query });
  assert.deepEqual(plan.pending.map((f) => f.name), ['002_b.sql', '003_c.sql']);
  assert.deepEqual(applied, []);
  assert.equal(migrationRequests(db.sent).length, 0);
});

test('migrate applies pending files in order, each with its history row, and reads them back', async () => {
  const db = fakeDb({ history: recorded(FILES.slice(0, 1)) });
  const { applied } = await migrate({ files: FILES, project: PROJECT, query: db.query, apply: true });
  assert.deepEqual(applied, ['002_b.sql', '003_c.sql']);
  const reqs = migrationRequests(db.sent);
  assert.equal(reqs.length, 2);
  for (const [i, f] of FILES.slice(1).entries()) {
    assert.ok(reqs[i].startsWith('begin;\nset local lock_timeout'));
    assert.ok(reqs[i].includes(f.sql));
    assert.ok(reqs[i].includes(`values ('${f.name}', '${f.checksum}', 'migrate');\ncommit;`));
  }
  assert.deepEqual(db.state.history.map((r) => r.name), ['001_a.sql', '002_b.sql', '003_c.sql']);
});

test('migrate stops on a changed file before applying anything', async () => {
  const db = fakeDb({ history: [{ name: '001_a.sql', checksum: 'sha256:old' }] });
  await assert.rejects(migrate({ files: FILES, project: PROJECT, query: db.query, apply: true }), StopError);
  assert.equal(migrationRequests(db.sent).length, 0);
});

test('migrate stops on a recorded migration this checkout does not have', async () => {
  const db = fakeDb({ history: [...recorded(FILES), { name: '004_newer.sql', checksum: 'sha256:n' }] });
  await assert.rejects(migrate({ files: FILES, project: PROJECT, query: db.query, apply: true }), StopError);
});

test('migrate stops when a pending file is numbered below an applied one', async () => {
  const db = fakeDb({ history: recorded([FILES[0], FILES[2]]) });
  await assert.rejects(migrate({ files: FILES, project: PROJECT, query: db.query, apply: true }), /Stopped before applying/);
  assert.equal(migrationRequests(db.sent).length, 0);
});

test('migrate refuses a database without schema_migrations', async () => {
  await assert.rejects(migrate({ files: FILES, project: PROJECT, query: fakeDb().query }), /no schema_migrations table/);
});

test('migrate leaves the owner 900-999 migrations alone', async () => {
  const mine = file('901_mine.sql');
  const db = fakeDb({ history: [...recorded(FILES), { name: '950_other.sql', checksum: 'sha256:any' }] });
  const { plan, applied } = await migrate({ files: [...FILES, mine], project: PROJECT, query: db.query, apply: true });
  assert.ok(plan.ok);
  assert.deepEqual(plan.pending, []);
  assert.deepEqual(applied, []);
  assert.equal(migrationRequests(db.sent).length, 0);
  assert.deepEqual(planUpdate([mine], [{ name: '901_mine.sql', checksum: 'sha256:changed' }]).mismatch, []);
});

test('migrate stops at the first failure and sends nothing after it', async () => {
  const db = fakeDb({ history: [], failOn: '002_b.sql' });
  await assert.rejects(migrate({ files: FILES, project: PROJECT, query: db.query, apply: true }), /002_b\.sql failed and was rolled back/);
  assert.equal(migrationRequests(db.sent).length, 2);
  assert.ok(db.sent.includes('rollback'));
});

test('migrate stops at a missing acknowledgement', async () => {
  const db = fakeDb({ history: [], dropAckOn: '001_a.sql' });
  await assert.rejects(migrate({ files: FILES, project: PROJECT, query: db.query, apply: true }), /001_a\.sql: no acknowledgement/);
  assert.equal(migrationRequests(db.sent).length, 1);
});

// ── Transports ──────────────────────────────────────────────────────────────

test('managementQuery posts the SQL with the token and returns rows', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => [{ one: 1 }] };
  };
  const q = managementQuery(PROJECT, 'tok', fetchImpl);
  assert.deepEqual(await q('select 1 as one'), [{ one: 1 }]);
  assert.equal(calls[0].url, `https://api.supabase.com/v1/projects/${PROJECT}/database/query`);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0].init.body), { query: 'select 1 as one' });
});

test('managementQuery refuses without a token and surfaces HTTP errors', async () => {
  assert.throws(() => managementQuery(PROJECT, undefined), /SUPABASE_ACCESS_TOKEN/);
  const q = managementQuery(PROJECT, 'tok', async () => ({ ok: false, status: 400, text: async () => 'syntax error' }));
  await assert.rejects(q('nope'), /HTTP 400: syntax error/);
  const odd = managementQuery(PROJECT, 'tok', async () => ({ ok: true, json: async () => ({}) }));
  await assert.rejects(odd('x'), /Unexpected/);
});

test('the bundled Supabase root CA is the pinned certificate', () => {
  const cert = new X509Certificate(readFileSync(BUNDLED_CA));
  assert.equal(cert.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
});

test('no migration still mentions the two-repo history', () => {
  for (const f of officialMigrations(REPO_MIGRATIONS)) {
    assert.doesNotMatch(f.sql, /\bfrontend\b|\bstarter\b|repo in \(/i, f.name);
  }
});

// ── apply-migration ─────────────────────────────────────────────────────────

test('apply-migration applies and records one owner migration, and refuses Solo OS numbers and repeats', async () => {
  const { applyOne } = await import('./apply-migration.mjs');
  const mine = file('901_mine.sql');
  const db = fakeDb({ history: recorded(FILES) });
  await applyOne({ file: mine, project: PROJECT, query: db.query });
  assert.ok(db.state.history.some((r) => r.name === '901_mine.sql' && r.checksum === mine.checksum));
  assert.ok(migrationRequests(db.sent)[0].includes("'apply-migration');\ncommit;"));
  await assert.rejects(applyOne({ file: mine, project: PROJECT, query: db.query }), /already recorded/);
  await assert.rejects(applyOne({ file: file('004_d.sql'), project: PROJECT, query: db.query }), /migrate\.mjs/);
  await assert.rejects(applyOne({ file: mine, project: PROJECT, query: fakeDb().query }), /No schema_migrations/);
});
