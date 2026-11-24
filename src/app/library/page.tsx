'use client';
/**
 * Library - previews of the owner's images, videos, audio and documents,
 * each linking back to the original wherever it lives (Mac folder, Google
 * Drive, Dropbox, YouTube, any link). Only small previews are stored here.
 * See LIBRARY.md.
 */
import { useCallback, useEffect, useState } from 'react';
import { FilterTabs, SectionHeading, ghostButtonStyle, solidButtonStyle } from '@/components/solo/kit';
import { EmptyState } from '@/components/crm/kit';
import { AssetViewer } from '@/components/library/asset-viewer';
import { AddAsset } from '@/components/library/add-asset';
import { LIBRARY_SOURCES, SOURCE_LABEL } from '@/lib/library/contract';
import type { ClientAsset } from '@/lib/library/client-shape';

type Status = {
  ready: boolean;
  bucket: boolean;
  youtube_connections: number;
  error?: string;
  stats?: { assets: number; visible: number; previews: number; preview_bytes: number; by_source: Record<string, number>; collections: Record<string, number> };
  tags?: { tag: string; n: number }[];
};

const PAGE = 60;
const KIND_TABS = [
  { value: '', label: 'all' },
  { value: 'image', label: 'images' },
  { value: 'video', label: 'video' },
  { value: 'audio', label: 'audio' },
  { value: 'doc', label: 'docs' },
];

export default function LibraryPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [items, setItems] = useState<ClientAsset[] | null>(null);
  const [more, setMore] = useState(false);
  const [kind, setKind] = useState('');
  const [source, setSource] = useState('');
  const [collection, setCollection] = useState('');
  const [tag, setTag] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState<ClientAsset | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/library/status');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`);
      setStatus(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the Library');
    }
  }, []);

  const query = useCallback((before?: string) => {
    const p = new URLSearchParams({ limit: String(PAGE) });
    if (kind) p.set('kind', kind);
    if (source) p.set('source', source);
    if (collection) p.set('collection', collection);
    if (tag) p.set('tag', tag);
    if (search) p.set('q', search);
    if (hidden) p.set('hidden', '1');
    if (before) p.set('before', before);
    return `/api/library/assets?${p}`;
  }, [kind, source, collection, tag, search, hidden]);

  const load = useCallback(async (append?: string) => {
    try {
      const res = await fetch(query(append));
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`);
      const page = body.assets as ClientAsset[];
      setError('');
      setItems((prev) => (append ? [...(prev || []), ...page] : page));
      setMore(page.length === PAGE);
    } catch (e) {
      setItems((prev) => prev || []);
      setError(e instanceof Error ? e.message : 'Could not load the Library');
    }
  }, [query]);

  useEffect(() => {
    void Promise.resolve().then(loadStatus);
  }, [loadStatus]);
  // Reload whenever a filter changes; the old grid stays until the new page arrives.
  useEffect(() => {
    if (status?.ready) void Promise.resolve().then(() => load());
  }, [status?.ready, load]);
  // Search as you type, a moment after the last keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const importYouTube = async () => {
    setImporting(true); setNotice(''); setError('');
    try {
      const res = await fetch('/api/library/import/youtube', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Import failed (${res.status})`);
      const r = (body.results || []) as { channel: string; created: number; updated: number; unchanged: number; failed: number; errors: string[] }[];
      setNotice(r.map((x) => `${x.channel}: ${x.created} new, ${x.updated} updated, ${x.unchanged} unchanged${x.failed ? `, ${x.failed} failed (${x.errors[0] || ''})` : ''}`).join('. '));
      await Promise.all([loadStatus(), load()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const saved = (a: ClientAsset) => {
    setItems((list) => {
      const rest = (list || []).filter((x) => x.id !== a.id);
      return a.hidden !== hidden ? rest : (list || []).map((x) => (x.id === a.id ? a : x));
    });
    setOpen(a.hidden !== hidden ? null : a);
    loadStatus();
  };

  const stats = status?.stats;
  const collections = Object.entries(stats?.collections || {}).sort((a, b) => b[1] - a[1]);
  const sources = LIBRARY_SOURCES.filter((s) => (stats?.by_source?.[s] ?? 0) > 0);

  return (
    <div className="stack wide">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: 'var(--h3)', fontWeight: 600, margin: 0 }}>Library</h1>
        </div>
        <div className="lib-actions">
          {status?.ready && status.youtube_connections > 0 && (
            <button type="button" style={ghostButtonStyle} disabled={importing} onClick={importYouTube}>
              {importing ? 'importing...' : 'Import from YouTube'}
            </button>
          )}
          {status?.ready && <button type="button" style={solidButtonStyle} onClick={() => setAdding((v) => !v)}>Add</button>}
        </div>
      </div>

      {status && !status.ready && (
        <div className="card lib-muted">{status.error || 'The Library is not set up yet.'} Your manager can do this; see LIBRARY.md.</div>
      )}

      {adding && (
        <AddAsset onCancel={() => setAdding(false)} onAdded={(a) => { setAdding(false); setItems((l) => [a, ...(l || []).filter((x) => x.id !== a.id)]); loadStatus(); }} />
      )}

      {status?.ready && (
        <>
          <FilterTabs ariaLabel="kind" options={KIND_TABS} value={kind} onChange={setKind} />
          <div className="lib-bar">
            <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="search titles" aria-label="search titles" />
            {sources.length > 1 && (
              <select className="lib-select" value={source} onChange={(e) => setSource(e.target.value)} aria-label="source">
                <option value="">all sources</option>
                {sources.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
              </select>
            )}
            {collections.length > 0 && (
              <select className="lib-select" value={collection} onChange={(e) => setCollection(e.target.value)} aria-label="collection">
                <option value="">all collections</option>
                {collections.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
              </select>
            )}
            {(status.tags?.length ?? 0) > 0 && (
              <select className="lib-select" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="tag">
                <option value="">all tags</option>
                {status.tags!.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.n})</option>)}
              </select>
            )}
            <button type="button" style={ghostButtonStyle} onClick={() => setHidden((v) => !v)} aria-pressed={hidden}>
              {hidden ? 'showing hidden' : 'hidden'}
            </button>
          </div>
        </>
      )}

      {notice && <div className="lib-muted" role="status">{notice}</div>}
      {error && <div className="lib-error" role="alert">{error}</div>}

      {status?.ready && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SectionHeading label={hidden ? 'hidden' : 'previews'} count={items?.length} />
          {!items ? (
            <div className="lib-muted">loading...</div>
          ) : items.length === 0 ? (
            search || kind || source || collection || tag || hidden
              ? <EmptyState title="Nothing matches" />
              : <EmptyState title="Nothing here yet" hint="Add a link, import from YouTube, or ask your manager to sync a folder on your Mac." />
          ) : (
            <div className="tiles">
              {items.map((a) => (
                <button key={a.id} type="button" className="tile" onClick={() => setOpen(a)} aria-label={a.title || a.kind}>
                  {a.preview_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.preview_url} alt="" loading="lazy" />
                  ) : (
                    <span className="lib-placeholder"><span className="k">{a.kind}</span>{a.title}</span>
                  )}
                  {a.kind !== 'image' && <span className="badge">{a.kind}</span>}
                  {a.source !== 'mac' && a.source !== 'upload' && <span className="badge right">{SOURCE_LABEL[a.source]}</span>}
                </button>
              ))}
            </div>
          )}
          {more && items && items.length > 0 && (
            <button type="button" style={{ ...ghostButtonStyle, alignSelf: 'center' }} onClick={() => load(items[items.length - 1].added_at)}>
              load more
            </button>
          )}
        </section>
      )}

      {open && <AssetViewer key={open.id + open.updated_at} asset={open} onClose={() => setOpen(null)} onSaved={saved} />}
    </div>
  );
}
