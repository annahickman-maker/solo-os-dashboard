'use client';

/**
 * Setup card: where Library previews come from (Mac folder sync, YouTube
 * import), how many previews there are and how much storage they use.
 * Originals are never stored; see LIBRARY.md. Reads /api/library/status.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from './kit';
import { ConnectionsCard, type ConnectionRow } from './connections-card';
import { formatBytes } from '@/lib/library/contract';

type Run = { status: 'ok' | 'partial' | 'failed'; label: string | null; scanned: number; created: number; updated: number; failed: number; note: string | null; finished_at: string };
type Status = {
  ready: boolean;
  bucket: boolean;
  youtube_connections: number;
  error?: string;
  stats?: { assets: number; previews: number; preview_bytes: number };
  runs?: Partial<Record<'mac' | 'youtube', Run>>;
};

const FREE_BYTES = 10 * 1024 ** 3;

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function runDetail(run: Run): string {
  const counts = `${run.scanned} checked, ${run.created} new, ${run.updated} updated${run.failed ? `, ${run.failed} failed` : ''}`;
  return `Last run ${when(run.finished_at)}${run.label ? ` (${run.label})` : ''}: ${counts}.${run.status !== 'ok' && run.note ? ` ${run.note}` : ''}`;
}

function rows(s: Status): ConnectionRow[] {
  const mac = s.runs?.mac;
  const yt = s.runs?.youtube;
  const used = s.stats?.preview_bytes ?? 0;
  return [
    {
      label: 'Library storage',
      state: !s.ready ? 'off' : s.bucket ? 'ok' : 'warn',
      detail: !s.ready
        ? 'Apply migration 023 to turn the Library on.'
        : s.bucket
          ? 'Private previews bucket connected (LIBRARY_PREVIEWS).'
          : 'No LIBRARY_PREVIEWS bucket bound: links and metadata work, previews cannot be saved. See LIBRARY.md.',
    },
    {
      label: 'Mac folder sync',
      state: !mac ? 'off' : mac.status === 'ok' ? 'ok' : 'warn',
      detail: mac ? runDetail(mac) : 'Not run yet. Your manager can schedule scripts/library-sync.mjs on your Mac.',
    },
    {
      label: 'YouTube import',
      state: yt ? (yt.status === 'ok' ? 'ok' : 'warn') : s.youtube_connections ? 'warn' : 'off',
      detail: yt
        ? runDetail(yt)
        : s.youtube_connections
          ? 'Channel connected; not imported yet. Use "Import from YouTube" on the Library page.'
          : 'No YouTube channel connected. Connect one in Social to import your videos.',
    },
    {
      label: 'Previews',
      state: s.ready && (s.stats?.previews ?? 0) > 0 ? 'ok' : 'off',
      detail: s.ready
        ? `${s.stats?.assets ?? 0} items, ${s.stats?.previews ?? 0} previews using ${formatBytes(used)} of the 10 GB free storage tier (${((used / FREE_BYTES) * 100).toFixed(used ? 2 : 0)}%). Originals stay where they are.`
        : 'Nothing yet.',
    },
  ];
}

export default function LibraryConnections() {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const c = new AbortController();
    api<Status>('/api/library/status', { signal: c.signal })
      .then(setData)
      .catch((e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : 'Could not check');
      });
    return () => c.abort();
  }, []);

  return (
    <ConnectionsCard
      title="Library connections"
      intro="Where your Library previews come from. Only small previews and links are stored here; your originals stay on your Mac, Drive, Dropbox or YouTube."
      rows={data ? rows(data) : null}
      error={error}
      footer={
        <>
          <Link className="underline" href="/library">Open the Library</Link>
          <Link className="underline" href="/crm/settings/agents">Mint a library:write key</Link>
        </>
      }
    />
  );
}
