'use client';

/**
 * Setup card: Memory connections. Whether memory is installed, the inbox
 * (on/off, generate, rotate, turn off), how many documents there are, the
 * last import, and whether embeddings and answers are ready. Reads
 * /api/memory/settings; the inbox token is shown once, right after it is
 * generated, and never again.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ConnectionsCard, type ConnectionRow } from './connections-card';
import { api, timeAgo } from './kit';

type Status = {
  available: boolean;
  documents: number;
  chunks: number;
  embedded: number;
  last_import_at: string | null;
  embeddings_available: boolean;
  answers_available: boolean;
  inbox: { on: true; token_prefix: string; created_at: string } | { on: false };
  inbox_path: string;
};

function rows(s: Status): ConnectionRow[] {
  if (!s.available) {
    return [{ label: 'Memory tables', state: 'off', detail: 'Not installed. Apply migration 022_memory.sql (see INSTALL.md).' }];
  }
  const missing = s.chunks - s.embedded;
  return [
    {
      label: 'Inbox',
      state: s.inbox.on ? 'ok' : 'off',
      detail: s.inbox.on
        ? `On. Token ${s.inbox.token_prefix}... made ${timeAgo(s.inbox.created_at)}. Zapier, Make and the folder script post here.`
        : 'Off. Generate a token to let Zapier, Make or the folder script add transcripts.',
    },
    {
      label: 'Documents',
      state: s.documents > 0 ? 'ok' : 'off',
      detail: s.documents > 0 ? `${s.documents} in memory, ${s.chunks} searchable passages.` : 'None yet. Add one on the Memory page.',
    },
    {
      label: 'Last import',
      state: s.last_import_at ? 'ok' : 'off',
      detail: s.last_import_at ? `${timeAgo(s.last_import_at)} (${new Date(s.last_import_at).toLocaleString()}).` : 'Nothing imported yet.',
    },
    {
      label: 'Embeddings',
      state: !s.embeddings_available ? 'warn' : missing > 0 ? 'warn' : 'ok',
      detail: !s.embeddings_available
        ? 'No Workers AI binding here (local dev): search uses keywords only. The deployed dashboard has it.'
        : missing > 0
          ? `${missing} passages still need an embedding. Until then they are found by keywords.`
          : 'Ready: search understands meaning as well as keywords.',
    },
    {
      label: 'Answers',
      state: s.answers_available ? 'ok' : 'off',
      detail: s.answers_available ? 'Your Anthropic key is set: questions get answers with sources.' : 'No ANTHROPIC_API_KEY: search works, answers are off.',
    },
  ];
}

export default function MemoryConnections() {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setData(await api<Status>('/api/memory/settings', { signal }));
      setError('');
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Could not check');
    }
  }, []);

  useEffect(() => {
    const c = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial status load
    void load(c.signal);
    return () => c.abort();
  }, [load]);

  const act = async (action: 'rotate' | 'revoke' | 'embed') => {
    if (action === 'rotate' && data?.inbox.on && !window.confirm('Make a new inbox token? The old one stops working, so update Zapier, Make and the folder script.')) return;
    if (action === 'revoke' && !window.confirm('Turn the inbox off? Every connection using the token stops importing.')) return;
    setBusy(action);
    setNote('');
    try {
      const r = await api<{ token?: string; embedded?: number }>('/api/memory/settings', { method: 'POST', body: JSON.stringify({ action }) });
      if (action === 'rotate') setToken(r.token || '');
      if (action === 'revoke') setToken('');
      if (action === 'embed') setNote(`Embedded ${r.embedded ?? 0} passages.`);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy('');
    }
  };

  const inboxUrl = typeof window !== 'undefined' && data ? `${window.location.origin}${data.inbox_path}` : '/api/memory/inbox';
  const missing = data ? data.chunks - data.embedded : 0;
  const btn = 'underline disabled:opacity-50';

  return (
    <ConnectionsCard
      title="Memory connections"
      intro={
        <>
          Optional. Send every call transcript and content piece into Memory automatically through one inbox: Zapier, Make, a
          folder on your Mac or your manager. Recipes are in MEMORY.md.
        </>
      }
      rows={data ? rows(data) : null}
      error={error}
      footer={
        data?.available ? (
          <>
            {token && (
              <div className="basis-full flex flex-col gap-1 rounded-md border border-yellow-500/20 bg-yellow-500/5 p-3">
                <span className="text-xs text-zinc-300">Copy this token now. It is shown once and only its hash is kept.</span>
                <code className="text-[12px] text-white break-all select-all">{token}</code>
                <span className="text-xs text-zinc-500 break-all">
                  Send it as <code>Authorization: Bearer &lt;token&gt;</code> to <code>{inboxUrl}</code>
                </span>
              </div>
            )}
            <button type="button" className={btn} disabled={!!busy} onClick={() => act('rotate')}>
              {busy === 'rotate' ? 'Generating…' : data.inbox.on ? 'Rotate inbox token' : 'Turn on the inbox'}
            </button>
            {data.inbox.on && (
              <button type="button" className={btn} disabled={!!busy} onClick={() => act('revoke')}>
                {busy === 'revoke' ? 'Turning off…' : 'Turn the inbox off'}
              </button>
            )}
            {data.embeddings_available && missing > 0 && (
              <button type="button" className={btn} disabled={!!busy} onClick={() => act('embed')}>
                {busy === 'embed' ? 'Embedding…' : 'Embed waiting passages'}
              </button>
            )}
            <Link className="underline" href="/memory">
              Open Memory
            </Link>
            {note && <span className="basis-full text-xs text-zinc-500">{note}</span>}
          </>
        ) : null
      }
    />
  );
}
