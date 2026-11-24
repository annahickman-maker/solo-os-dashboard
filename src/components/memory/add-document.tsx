'use client';

/**
 * Add to memory: paste text, or upload .txt .md .vtt .srt files. Uploading
 * the same file name again updates that document instead of adding a copy.
 */
import { useRef, useState } from 'react';
import { api, Field, GhostBtn, Modal, PrimaryBtn, Select, TextArea, TextInput } from '@/components/crm/kit';
import { KIND_LABEL, type Kind } from './types';

const MAX_FILE_BYTES = 1_500_000;
const ACCEPT = '.txt,.md,.markdown,.vtt,.srt,text/plain,text/markdown,text/vtt';

type Result = { status: 'created' | 'updated' | 'unchanged'; title: string; pending_embeddings: number };

export function AddDocument({ onClose, onAdded, uploadOnly = false }: { onClose: () => void; onAdded: (message: string) => void; uploadOnly?: boolean }) {
  const [mode, setMode] = useState<'paste' | 'upload'>(uploadOnly ? 'upload' : 'paste');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Kind>('note');
  const [date, setDate] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const post = (body: Record<string, unknown>) =>
    api<Result>('/api/memory/documents', { method: 'POST', body: JSON.stringify({ kind, occurred_at: date || undefined, ...body }) });

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (mode === 'paste') {
        if (!text.trim()) throw new Error('Paste some text first');
        const r = await post({ source: 'paste', title: title.trim() || undefined, text });
        onAdded(r.status === 'unchanged' ? 'Already in memory' : `Added "${r.title}"`);
      } else {
        if (!files.length) throw new Error('Choose at least one file');
        const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
        if (tooBig) throw new Error(`${tooBig.name} is over 1.5 MB. Split it into parts.`);
        let added = 0;
        let same = 0;
        for (const f of files) {
          const r = await post({
            source: 'upload',
            source_id: f.name,
            filename: f.name,
            title: files.length === 1 && title.trim() ? title.trim() : undefined,
            text: await f.text(),
            occurred_at: date || (f.lastModified ? new Date(f.lastModified).toISOString() : undefined),
          });
          if (r.status === 'unchanged') same++;
          else added++;
        }
        onAdded(`${added} added or updated${same ? `, ${same} already in memory` : ''}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={uploadOnly ? 'Upload to memory' : 'Add to memory'} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        {!uploadOnly && (
        <div className="flex gap-2" role="tablist" aria-label="How to add">
          {(['paste', 'upload'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`text-[13px] px-3 py-1.5 rounded-lg border ${mode === m ? 'border-zinc-400 text-white' : 'border-minimal-border text-minimal-muted'}`}
            >
              {m === 'paste' ? 'Paste text' : 'Upload files'}
            </button>
          ))}
        </div>
        )}

        {mode === 'paste' ? (
          <Field label="Text" hint="A transcript, a voice note, an idea, a script. Captions (.vtt/.srt) are cleaned of timestamps.">
            <TextArea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste here" />
          </Field>
        ) : (
          <Field label="Files" hint=".txt, .md, .vtt or .srt, up to 1.5 MB each. The same file name again updates it.">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={ACCEPT}
              onChange={(e) => setFiles([...(e.target.files || [])])}
              className="block w-full text-[13px] text-zinc-400 file:mr-3 file:rounded-lg file:border file:border-minimal-border file:bg-transparent file:px-3 file:py-1.5 file:text-white"
            />
            {files.length > 0 && <span className="block text-xs text-zinc-500 mt-1">{files.map((f) => f.name).join(', ')}</span>}
          </Field>
        )}

        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Title (optional)">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder={mode === 'upload' ? 'File name' : 'First line'} />
          </Field>
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date (optional)">
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>

        {error && (
          <p role="alert" className="text-[13px] text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <GhostBtn onClick={onClose}>Cancel</GhostBtn>
          <PrimaryBtn onClick={() => void submit()} disabled={busy}>
            {busy ? 'Adding…' : 'Add'}
          </PrimaryBtn>
        </div>
      </div>
    </Modal>
  );
}
