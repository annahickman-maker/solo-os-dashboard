'use client';
/**
 * Add one item by hand: a link to the original (any URL: Drive, Dropbox, a
 * page) and/or a note of where it lives, plus an optional preview the owner
 * picks. The preview is shrunk in the browser; the original is not uploaded.
 */
import { useState } from 'react';
import { ghostButtonStyle, solidButtonStyle } from '@/components/solo/kit';
import { LIBRARY_KINDS, formatBytes, type LibraryKind } from '@/lib/library/contract';
import type { ClientAsset } from '@/lib/library/client-shape';
import { makePreview, type MadePreview } from './make-preview';

export function AddAsset({ onAdded, onCancel }: { onAdded: (a: ClientAsset) => void; onCancel: () => void }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<LibraryKind>('image');
  const [collection, setCollection] = useState('');
  const [tags, setTags] = useState('');
  const [preview, setPreview] = useState<MadePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (file: File | undefined) => {
    setError('');
    if (!file) { setPreview(null); return; }
    try {
      setPreview(await makePreview(file));
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : 'Could not read that image');
    }
  };

  const submit = async () => {
    setError('');
    const link = url.trim();
    if (!link && !label.trim()) { setError('Add a link to the original, or say where it lives'); return; }
    setBusy(true);
    try {
      const body = {
        source: link ? 'link' : 'upload',
        source_id: link || `upload:${crypto.randomUUID()}`,
        kind, title, collection, tags,
        original_url: link || null,
        original_label: label.trim() || null,
        width: preview && kind === 'image' ? preview.width : null,
        height: preview && kind === 'image' ? preview.height : null,
        preview_base64: preview?.base64 ?? null,
      };
      const res = await fetch('/api/library/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Could not add (${res.status})`);
      onAdded(data.asset as ClientAsset);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="eyebrow">add by link</div>
      <div className="lib-form">
        <label className="full">link to the original
          <input className="input" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
        </label>
        <label className="full">or where it lives (optional with a link)
          <input className="input" value={label} maxLength={1000} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Phone camera roll, Mac: Shoots/2026" />
        </label>
        <label>title
          <input className="input" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>kind
          <select className="lib-select" value={kind} onChange={(e) => setKind(e.target.value as LibraryKind)}>
            {LIBRARY_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label>collection
          <input className="input" value={collection} maxLength={80} onChange={(e) => setCollection(e.target.value)} />
        </label>
        <label>tags
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="comma separated" />
        </label>
        <label className="full">preview image (optional; shrunk to about 800px on this device)
          <input type="file" accept="image/*" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
      </div>
      {preview && <div className="lib-muted">Preview ready: {formatBytes(preview.bytes)}.</div>}
      {error && <div className="lib-error" role="alert">{error}</div>}
      <div className="lib-actions">
        <button type="button" style={solidButtonStyle} disabled={busy} onClick={submit}>{busy ? 'adding...' : 'add'}</button>
        <button type="button" style={ghostButtonStyle} onClick={onCancel}>cancel</button>
      </div>
    </div>
  );
}
