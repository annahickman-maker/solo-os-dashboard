'use client';

/** Everything in memory: filter by kind, search titles, newest first. */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, EmptyState, GhostBtn, Loading } from '@/components/crm/kit';
import { SectionHeading } from '@/components/solo/kit';
import { docDate, docHref, KIND_LABEL, type DocumentSummary, type Kind } from './types';

const PAGE = 30;

export function DocumentList({ refreshKey, kind = '' }: { refreshKey: number; kind?: '' | Kind }) {
  const query = '';
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (offset: number) => {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (kind) params.set('kind', kind);
      if (query) params.set('q', query);
      try {
        const r = await api<{ documents: DocumentSummary[]; total: number; has_more: boolean }>(`/api/memory/documents?${params}`);
        setDocs((prev) => (offset === 0 ? r.documents : [...(prev || []), ...r.documents]));
        setTotal(r.total);
        setHasMore(r.has_more);
        setError('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load documents');
      }
    },
    [kind, query],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reload when filters change
    void load(0);
  }, [load, refreshKey]);

  const groups = (Object.keys(KIND_LABEL) as Kind[])
    .map((k) => ({ kind: k, items: (docs || []).filter((d) => d.kind === k) }))
    .filter((g) => g.items.length > 0);
  const other = (docs || []).filter((d) => !(d.kind in KIND_LABEL));
  if (other.length) groups.push({ kind: 'note', items: other });

  return (
    <section className="flex flex-col gap-6">
      <SectionHeading label="transcripts" count={docs ? total : undefined} />
      {error ? (
        <p role="alert" className="text-[13px] text-red-400">
          {error}
        </p>
      ) : !docs ? (
        <Loading />
      ) : docs.length === 0 ? (
        <EmptyState
          title={query || kind ? 'Nothing matches' : 'No transcripts yet'}
          hint={query || kind ? undefined : 'Add one below, or turn on the inbox in Setup to import them automatically.'}
        />
      ) : (
        <>
          {groups.map((g) => (
            <div key={g.kind} className="flex flex-col gap-2">
              <h2 className="text-[13px] font-semibold text-zinc-300">
                {KIND_LABEL[g.kind]}s <span className="text-zinc-500 font-normal">{g.items.length}</span>
              </h2>
              <ul className="border border-minimal-border rounded-lg divide-y divide-minimal-border">
                {g.items.map((d) => (
                  <li key={d.id}>
                    <Link href={docHref(d.id)} className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02]">
                      <span className="flex-1 min-w-0 text-[14px] text-white truncate">{d.title}</span>
                      <span className="text-xs text-zinc-500 shrink-0">{docDate(d)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {hasMore && (
            <div>
              <GhostBtn onClick={() => void load(docs.length)}>Load more</GhostBtn>
            </div>
          )}
          <p className="text-xs text-zinc-500">{total} in total</p>
        </>
      )}
    </section>
  );
}
