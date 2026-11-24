#!/usr/bin/env node
/**
 * memory-import.mjs - sends a local folder of transcripts and notes to your
 * dashboard's memory inbox. Run it by hand or on a schedule (MEMORY.md shows
 * a launchd job your manager can install on your Mac).
 *
 *   MEMORY_INBOX_URL=https://<your dashboard>/api/memory/inbox \
 *   node scripts/memory-import.mjs ~/Transcripts --kind conversation
 *
 * Options:
 *   --kind conversation|content|note   what the files are (default note)
 *   --source <name>                    the source label (default folder)
 *   --state <file>                     where it remembers what it sent
 *                                      (default ~/.solo-os/memory-import-state.json)
 *   --dry-run                          list what would be sent, send nothing
 *
 * The token comes from MEMORY_INBOX_TOKEN, or the file named by
 * MEMORY_INBOX_TOKEN_FILE (default ~/.solo-os/memory-inbox-token, readable
 * only by you). It is never printed.
 *
 * Idempotent twice over: a file is only sent when its path, size or
 * modified time changed since the last successful send, and the inbox
 * itself treats the same source + path as the same document (an edited file
 * updates it). Files: .txt .md .markdown .vtt .srt, up to 1.5 MB each.
 * Hidden files and folders are skipped. No dependencies; Node 22 or newer.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.vtt', '.srt']);
export const MAX_FILE_BYTES = 1_500_000;
const CONTENT_TYPE = { '.txt': 'text/plain', '.md': 'text/markdown', '.markdown': 'text/markdown', '.vtt': 'text/vtt', '.srt': 'application/x-subrip' };
const KINDS = new Set(['conversation', 'content', 'note']);

/** Every importable file under `root`, as { path, rel, size, mtimeMs }. Sorted, hidden entries skipped. */
export function scanFolder(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        const st = statSync(path);
        out.push({ path, rel: relative(root, path).split(sep).join('/'), size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
      }
    }
  };
  walk(root);
  return out;
}

/** What identifies one version of a file: its path, size and modified time. */
export function fingerprint(file) {
  return createHash('sha256').update(`${file.rel}\n${file.size}\n${file.mtimeMs}`).digest('hex').slice(0, 32);
}

/** Splits files into those to send, those unchanged since the last send, and those too large. */
export function planImports(files, state) {
  const send = [];
  const unchanged = [];
  const tooLarge = [];
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) tooLarge.push(f);
    else if (state[f.rel] === fingerprint(f)) unchanged.push(f);
    else send.push(f);
  }
  return { send, unchanged, tooLarge };
}

export function inboxUrlFor(base, file, { source, kind }) {
  const u = new URL(base);
  u.searchParams.set('source', source);
  u.searchParams.set('source_id', file.rel);
  u.searchParams.set('title', basename(file.rel, extname(file.rel)));
  u.searchParams.set('filename', basename(file.rel));
  u.searchParams.set('kind', kind);
  u.searchParams.set('occurred_at', new Date(file.mtimeMs).toISOString());
  return u.toString();
}

export function readState(path) {
  if (!existsSync(path)) return {};
  try {
    const s = JSON.parse(readFileSync(path, 'utf8'));
    return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  } catch {
    return {};
  }
}

function writeState(path, state) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * Sends what changed. `fetchImpl` and `log` are for tests. Returns counts;
 * a failed file is retried next run (its fingerprint is not saved).
 */
export async function importFolder({ root, url, token, source = 'folder', kind = 'note', statePath, dryRun = false, fetchImpl = fetch, log = console.log }) {
  const state = readState(statePath);
  const { send, unchanged, tooLarge } = planImports(scanFolder(root), state);
  for (const f of tooLarge) log(`skip (over 1.5 MB, split it): ${f.rel}`);
  const result = { sent: 0, created: 0, updated: 0, unchanged: unchanged.length, failed: 0, skipped: tooLarge.length };
  for (const f of send) {
    if (dryRun) { log(`would send: ${f.rel}`); continue; }
    try {
      const res = await fetchImpl(inboxUrlFor(url, f, { source, kind }), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': CONTENT_TYPE[extname(f.rel).toLowerCase()] || 'text/plain' },
        body: readFileSync(f.path, 'utf8'),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      result.sent++;
      if (body.status === 'created') result.created++;
      else if (body.status === 'updated') result.updated++;
      else result.unchanged++;
      state[f.rel] = fingerprint(f);
      writeState(statePath, state);
      log(`${body.status || 'sent'}: ${f.rel}`);
    } catch (e) {
      result.failed++;
      log(`failed: ${f.rel}: ${e instanceof Error ? e.message : e}`);
      if (/inbox token|inbox is off/i.test(String(e?.message))) break; // every other file would fail the same way
    }
  }
  return result;
}

function arg(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

async function main(argv) {
  const root = argv.find((a, i) => !a.startsWith('--') && !['--kind', '--source', '--state'].includes(argv[i - 1]));
  if (!root || argv.includes('--help')) {
    console.log('Usage: MEMORY_INBOX_URL=https://<dashboard>/api/memory/inbox node scripts/memory-import.mjs <folder> [--kind note] [--source folder] [--dry-run]');
    return root ? 0 : 2;
  }
  const kind = arg(argv, '--kind', 'note');
  if (!KINDS.has(kind)) throw new Error('--kind must be conversation, content or note');
  const source = arg(argv, '--source', 'folder');
  if (!/^[a-z0-9][a-z0-9_.:-]{0,63}$/.test(source)) throw new Error('--source must be lowercase letters, digits, _ . : or -');
  const url = process.env.MEMORY_INBOX_URL;
  if (!url || !/^https?:\/\/.+\/api\/memory\/inbox$/.test(url)) throw new Error('Set MEMORY_INBOX_URL to https://<your dashboard>/api/memory/inbox');
  if (url.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error('MEMORY_INBOX_URL must use https');
  const dryRun = argv.includes('--dry-run');
  let token = process.env.MEMORY_INBOX_TOKEN || '';
  const tokenFile = process.env.MEMORY_INBOX_TOKEN_FILE || join(homedir(), '.solo-os', 'memory-inbox-token');
  if (!token && existsSync(tokenFile)) token = readFileSync(tokenFile, 'utf8').trim();
  if (!token && !dryRun) throw new Error(`No inbox token: set MEMORY_INBOX_TOKEN or put it in ${tokenFile} (chmod 600)`);
  const statePath = resolve(arg(argv, '--state', join(homedir(), '.solo-os', 'memory-import-state.json')));
  const r = await importFolder({ root: resolve(root), url, token, source, kind, statePath, dryRun });
  console.log(`Done. ${r.created} new, ${r.updated} updated, ${r.unchanged} unchanged, ${r.skipped} skipped, ${r.failed} failed.`);
  return r.failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(2); });
}
