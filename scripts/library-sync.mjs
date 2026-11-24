#!/usr/bin/env node
/**
 * library-sync.mjs - adds a folder on your Mac to the Solo OS Library as
 * PREVIEWS ONLY. Each file gets a small preview (about 800px JPEG) made with
 * macOS built-ins, sent with its metadata; the original never leaves the Mac.
 * See LIBRARY.md.
 *
 *   SOLO_OS_URL=https://your-dashboard.example.com \
 *   LIBRARY_API_KEY=bbk_library-sync_... \
 *   node scripts/library-sync.mjs --folder ~/Pictures/Shoots [--name Shoots] [--collection shoots] [--dry-run] [--force] [--limit 500]
 *
 * Or put SOLO_OS_URL and LIBRARY_API_KEY in a file and pass --env-file <path>
 * (default ~/.solo-os/library-sync.env, read when present). The key must be a
 * minted agent key holding library:write; mint one in Setup -> Manage agent access.
 *
 * Previews: images with sips; videos with ffmpeg when installed (a frame one
 * second in), otherwise Quick Look (qlmanage -t); PDFs with Quick Look. Audio
 * and other files are listed without a preview.
 *
 * Idempotent: the server keys each file by (mac, "<name>/<relative path>"), so
 * re-running updates rather than duplicates. A local state file
 * (~/.solo-os/library-sync-state.json) skips files whose size and modified
 * time have not changed since they were last sent. Only the folder name and
 * relative paths are sent, never your home folder path.
 *
 * Schedule it (your manager can set this up): a launchd agent or cron entry
 * running this command daily. It exits non-zero only when every file failed.
 */
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_PREVIEW_BYTES = 400 * 1024;
const EDGE = 800;

const KINDS = {
  image: ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.tif', '.tiff', '.gif', '.bmp'],
  video: ['.mov', '.mp4', '.m4v', '.avi', '.mkv'],
  audio: ['.mp3', '.m4a', '.wav', '.aif', '.aiff', '.flac'],
  doc: ['.pdf', '.key', '.pages', '.docx', '.pptx'],
};

export function kindOf(file) {
  const ext = extname(file).toLowerCase();
  for (const [kind, exts] of Object.entries(KINDS)) if (exts.includes(ext)) return kind;
  return null;
}

/** Every file under root that the Library understands, hidden files and folders skipped. */
export function walk(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        // Photos and Final Cut libraries are packages; skip them.
        if (!/\.(photoslibrary|fcpbundle|app)$/i.test(e.name)) stack.push(p);
      } else if (e.isFile() && kindOf(e.name)) out.push(p);
    }
  }
  return out.sort();
}

/** What the server is sent for one file. No absolute paths. */
export function describe(root, name, file, collection) {
  const rel = relative(root, file).split(sep).join('/');
  const folders = rel.split('/').slice(0, -1);
  return {
    source: 'mac',
    source_id: `${name}/${rel}`,
    kind: kindOf(file),
    title: basename(file, extname(file)).slice(0, 300),
    original_label: `Mac: ${name}/${rel}`.slice(0, 1000),
    collection: collection || name.toLowerCase(),
    tags: folders.map((f) => f.toLowerCase()).slice(0, 10),
  };
}

export function sign(key, method, path, body, now = Date.now()) {
  const timestamp = String(Math.floor(now / 1000));
  const signature = createHmac('sha256', key).update([method, path, timestamp, body].join(':')).digest('hex');
  return { 'x-api-key': key, 'x-timestamp': timestamp, 'x-signature': signature };
}

function run(cmd, args) {
  return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }).toString();
}

function has(cmd) {
  try { execFileSync('/usr/bin/which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; }
}

function imageSize(file) {
  try {
    const out = run('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file]);
    const w = Number(/pixelWidth: (\d+)/.exec(out)?.[1]);
    const h = Number(/pixelHeight: (\d+)/.exec(out)?.[1]);
    return w && h ? { width: w, height: h } : {};
  } catch { return {}; }
}

function toJpeg(input, out, quality) {
  run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), '-Z', String(EDGE), input, '--out', out]);
}

/** A small JPEG preview of `file`, or null when none can be made. */
function makePreview(file, kind, work, tools) {
  const out = join(work, 'preview.jpg');
  rmSync(out, { force: true });
  let source = file;
  if (kind === 'video' && tools.ffmpeg) {
    const frame = join(work, 'frame.jpg');
    rmSync(frame, { force: true });
    try {
      run('ffmpeg', ['-v', 'error', '-y', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', `scale='min(${EDGE},iw)':-2`, frame]);
    } catch {
      run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-frames:v', '1', '-vf', `scale='min(${EDGE},iw)':-2`, frame]);
    }
    source = frame;
  } else if (kind === 'video' || kind === 'doc') {
    const ql = join(work, 'ql');
    rmSync(ql, { recursive: true, force: true });
    mkdirSync(ql);
    run('/usr/bin/qlmanage', ['-t', '-s', String(EDGE), '-o', ql, file]);
    const made = readdirSync(ql).find((f) => f.endsWith('.png'));
    if (!made) return null;
    source = join(ql, made);
  } else if (kind !== 'image') {
    return null;
  }
  for (const quality of [70, 50, 35]) {
    toJpeg(source, out, quality);
    const bytes = readFileSync(out);
    if (bytes.length <= MAX_PREVIEW_BYTES) return bytes;
  }
  return null;
}

function duration(file, tools) {
  if (tools.ffprobe) {
    try {
      const s = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim());
      if (Number.isFinite(s)) return s;
    } catch { /* fall through */ }
  }
  try {
    const s = Number(run('/usr/bin/mdls', ['-raw', '-name', 'kMDItemDurationSeconds', file]).trim());
    return Number.isFinite(s) ? s : null;
  } catch { return null; }
}

function readEnvFile(path) {
  const env = {};
  if (!path || !existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

export function parseArgs(argv) {
  const args = { dryRun: false, force: false, limit: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else if (a === '--folder') args.folder = argv[++i];
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--collection') args.collection = argv[++i];
    else if (a === '--env-file') args.envFile = argv[++i];
    else if (a === '--state') args.state = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]) || Infinity;
    else throw new Error(`Unknown option ${a}`);
  }
  return args;
}

async function post(base, key, path, payload) {
  const body = JSON.stringify(payload);
  const res = await fetch(new URL(path, base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...sign(key, 'POST', path, body) },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.folder) throw new Error('Pass --folder <path to the folder on this Mac>');
  const root = resolve(args.folder.replace(/^~(?=\/|$)/, homedir()));
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Not a folder: ${args.folder}`);
  const name = (args.name || basename(root)).replace(/[/\\]/g, '-').slice(0, 100);

  const env = { ...readEnvFile(args.envFile || join(homedir(), '.solo-os', 'library-sync.env')), ...process.env };
  const base = env.SOLO_OS_URL;
  const key = env.LIBRARY_API_KEY;
  if (!args.dryRun) {
    if (process.platform !== 'darwin') throw new Error('library-sync.mjs makes previews with macOS tools (sips, qlmanage); run it on a Mac');
    if (!base || !/^https?:\/\//.test(base)) throw new Error('Set SOLO_OS_URL to your dashboard address');
    if (!key) throw new Error('Set LIBRARY_API_KEY to a minted key with library:write');
  }

  const statePath = args.state || join(homedir(), '.solo-os', 'library-sync-state.json');
  let state = {};
  try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch { /* first run */ }
  const tools = { ffmpeg: has('ffmpeg'), ffprobe: has('ffprobe') };
  const work = mkdtempSync(join(tmpdir(), 'solo-os-library-'));
  const started = new Date().toISOString();
  const counts = { scanned: 0, created: 0, updated: 0, unchanged: 0, failed: 0 };
  const errors = [];

  try {
    const files = walk(root).slice(0, args.limit);
    for (const file of files) {
      counts.scanned++;
      const st = statSync(file);
      const id = `${name}/${relative(root, file)}`;
      const fingerprint = `${st.size}:${Math.floor(st.mtimeMs)}`;
      if (!args.force && state[id] === fingerprint) { counts.unchanged++; continue; }
      const asset = describe(root, name, file, args.collection);
      if (args.dryRun) { console.log(`would send ${asset.kind}: ${asset.source_id}`); continue; }
      try {
        let preview = null;
        try { preview = makePreview(file, asset.kind, work, tools); } catch { preview = null; }
        const size = asset.kind === 'image' ? imageSize(file) : {};
        const payload = {
          ...asset,
          ...size,
          duration_s: asset.kind === 'video' || asset.kind === 'audio' ? duration(file, tools) : null,
          taken_at: (st.birthtime && st.birthtime.getTime() > 0 ? st.birthtime : st.mtime).toISOString(),
          preview_base64: preview ? preview.toString('base64') : null,
        };
        const r = await post(base, key, '/api/library/assets', payload);
        counts[r.status === 'created' ? 'created' : r.status === 'updated' ? 'updated' : 'unchanged']++;
        state[id] = fingerprint;
      } catch (e) {
        counts.failed++;
        if (errors.length < 5) errors.push(`${asset.source_id}: ${e.message}`);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  console.log(`${name}: ${counts.scanned} checked, ${counts.created} new, ${counts.updated} updated, ${counts.unchanged} unchanged, ${counts.failed} failed`);
  for (const e of errors) console.error(`  ${e}`);
  if (args.dryRun) return 0;

  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
  const status = counts.failed === 0 ? 'ok' : counts.failed < counts.scanned - counts.unchanged ? 'partial' : 'failed';
  await post(base, key, '/api/library/sync-runs', { source: 'mac', label: name, status, ...counts, note: errors.join('; ').slice(0, 1000) || null, started_at: started })
    .catch((e) => console.error(`could not record the run: ${e.message}`));
  return status === 'failed' && counts.failed > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(1); });
}
