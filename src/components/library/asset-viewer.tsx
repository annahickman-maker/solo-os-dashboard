'use client';
/**
 * The open asset: a larger preview, a way back to the original (open the
 * link, or copy it / the path label), and the owner's edits: title, tags,
 * collection, hide.
 */
import { useEffect, useState } from 'react';
import { ghostButtonStyle, solidButtonStyle } from '@/components/solo/kit';
import { SOURCE_LABEL } from '@/lib/library/contract';
import type { ClientAsset } from '@/lib/library/client-shape';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function AssetViewer({ asset, onClose, onSaved }: {
  asset: ClientAsset;
  onClose: () => void;
  onSaved: (a: ClientAsset) => void;
}) {
  const [title, setTitle] = useState(asset.title);
  const [tags, setTags] = useState(asset.tags.join(', '));
  const [collection, setCollection] = useState(asset.collection ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async (change: Record<string, unknown>) => {
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/library/assets/${asset.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Could not save (${res.status})`);
      onSaved(body.asset as ClientAsset);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1500); }
    catch { setError('Copy is blocked in this browser'); }
  };

  const dims = asset.width && asset.height ? `${asset.width} x ${asset.height}` : null;
  const facts = [asset.kind, SOURCE_LABEL[asset.source], dims, asset.duration_s ? clock(asset.duration_s) : null,
    asset.taken_at ? new Date(asset.taken_at).toLocaleDateString() : null].filter(Boolean).join(' · ');

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={asset.title || 'Library item'} onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div className="eyebrow">{facts}</div>
          <button type="button" style={ghostButtonStyle} onClick={onClose}>close</button>
        </div>
        {asset.preview_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.preview_url} alt={asset.title || 'preview'} />
        ) : (
          <div className="lib-muted" style={{ padding: 32, textAlign: 'center' }}>No preview for this item.</div>
        )}

        <div className="lib-actions">
          {asset.original_url && (
            <a style={solidButtonStyle} href={asset.original_url} target="_blank" rel="noopener noreferrer">Open original</a>
          )}
          {asset.original_url && (
            <button type="button" style={ghostButtonStyle} onClick={() => copy(asset.original_url!, 'link')}>
              {copied === 'link' ? 'copied' : 'copy link'}
            </button>
          )}
          {asset.original_label && (
            <button type="button" style={ghostButtonStyle} onClick={() => copy(asset.original_label!, 'path')}>
              {copied === 'path' ? 'copied' : 'copy where it lives'}
            </button>
          )}
        </div>
        {asset.original_label && <div className="lib-muted">Original: {asset.original_label}</div>}

        <div className="lib-form">
          <label className="full">title
            <input className="input" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>tags (comma separated)
            <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. headshot, summer" />
          </label>
          <label>collection
            <input className="input" value={collection} maxLength={80} onChange={(e) => setCollection(e.target.value)} placeholder="e.g. thumbnails" />
          </label>
        </div>
        {error && <div className="lib-error" role="alert">{error}</div>}
        <div className="lib-actions">
          <button type="button" style={solidButtonStyle} disabled={busy} onClick={() => save({ title, tags, collection })}>
            {busy ? 'saving...' : 'save'}
          </button>
          <button type="button" style={ghostButtonStyle} disabled={busy} onClick={() => save({ hidden: !asset.hidden })}>
            {asset.hidden ? 'unhide' : 'hide'}
          </button>
        </div>
      </div>
    </div>
  );
}
