/** Tests for scripts/memory-import.mjs with a temporary folder and a fake inbox. No network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFolder, inboxUrlFor, MAX_FILE_BYTES, planImports, readState, scanFolder } from './memory-import.mjs';

const URL_ = 'https://dash.example.com/api/memory/inbox';
const TOKEN = 'mem_' + 'a'.repeat(40); // fabricated

function fakeInbox() {
  const seen = new Map();
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, init });
    if (init.headers.Authorization !== `Bearer ${TOKEN}`) return new Response(JSON.stringify({ error: 'Missing or wrong inbox token.' }), { status: 401 });
    const key = `${u.searchParams.get('source')}|${u.searchParams.get('source_id')}`;
    const status = !seen.has(key) ? 'created' : seen.get(key) === init.body ? 'unchanged' : 'updated';
    seen.set(key, init.body);
    return new Response(JSON.stringify({ ok: true, status }), { status: status === 'created' ? 201 : 200 });
  };
  return { fetchImpl, calls };
}

test('folder import: sends new files once, skips unchanged ones, resends edited ones, ignores hidden and other files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-import-'));
  const root = join(dir, 'Transcripts');
  const statePath = join(dir, 'state', 'state.json');
  try {
    mkdirSync(join(root, '2026', '.hidden'), { recursive: true });
    writeFileSync(join(root, 'call one.vtt'), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n');
    writeFileSync(join(root, '2026', 'idea.md'), '# Idea\n\nBody');
    writeFileSync(join(root, '2026', '.hidden', 'secret.txt'), 'no');
    writeFileSync(join(root, '.DS_Store'), 'no');
    writeFileSync(join(root, 'photo.jpg'), 'no');
    writeFileSync(join(root, 'huge.txt'), 'x'.repeat(MAX_FILE_BYTES + 1));

    assert.deepEqual(scanFolder(root).map((f) => f.rel), ['2026/idea.md', 'call one.vtt', 'huge.txt']);

    const inbox = fakeInbox();
    const log = [];
    const opts = { root, url: URL_, token: TOKEN, kind: 'conversation', statePath, fetchImpl: inbox.fetchImpl, log: (l) => log.push(l) };
    const first = await importFolder(opts);
    assert.deepEqual([first.created, first.failed, first.skipped], [2, 0, 1]);
    const vtt = inbox.calls.find((c) => c.url.searchParams.get('source_id') === 'call one.vtt');
    assert.equal(vtt.init.headers['Content-Type'], 'text/vtt');
    assert.equal(vtt.url.searchParams.get('kind'), 'conversation');
    assert.equal(vtt.url.searchParams.get('title'), 'call one');
    assert.equal(vtt.url.searchParams.get('source'), 'folder');
    assert.ok(!vtt.url.toString().includes(TOKEN), 'the token is never in the URL');
    assert.ok(!log.join('\n').includes(TOKEN), 'the token is never logged');

    const second = await importFolder(opts);
    assert.equal(second.sent, 0);
    assert.equal(inbox.calls.length, 2);

    writeFileSync(join(root, '2026', 'idea.md'), '# Idea\n\nBody, edited');
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(root, '2026', 'idea.md'), later, later);
    const third = await importFolder(opts);
    assert.deepEqual([third.sent, third.updated], [1, 1]);
    assert.equal(Object.keys(readState(statePath)).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('folder import: a refused token stops the run and saves nothing, so the next run retries', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mem-import-'));
  try {
    writeFileSync(join(dir, 'a.txt'), 'one');
    writeFileSync(join(dir, 'b.txt'), 'two');
    const statePath = join(dir, '..', `${Date.now()}-state.json`);
    const inbox = fakeInbox();
    const r = await importFolder({ root: dir, url: URL_, token: 'mem_wrong', statePath, fetchImpl: inbox.fetchImpl, log: () => {} });
    assert.deepEqual([r.sent, r.failed], [0, 1]);
    assert.equal(inbox.calls.length, 1);
    assert.deepEqual(readState(statePath), {});
    rmSync(statePath, { force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plan and url helpers', () => {
  const f = { rel: 'x/y.srt', size: 10, mtimeMs: 1767225600000 };
  assert.deepEqual(planImports([f], {}).send, [f]);
  const u = new URL(inboxUrlFor(URL_, f, { source: 'folder', kind: 'note' }));
  assert.equal(u.searchParams.get('occurred_at'), '2026-01-01T00:00:00.000Z');
  assert.equal(u.searchParams.get('filename'), 'y.srt');
});
