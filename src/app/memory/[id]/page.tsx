'use client';

/**
 * One memory document: its details and full text. Opened from an answer's
 * source, it scrolls to the passage (#passage-N) that was quoted.
 */
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, GhostBtn, Loading, PageHeader, fmtDate, useToast } from '@/components/crm/kit';
import { NoteEditor } from '@/components/memory/note-editor';
import { docDate, KIND_LABEL, type DocumentSummary } from '@/components/memory/types';

type Doc = DocumentSummary & { raw_text: string; speakers: string[]; owner_speaker: string | null; added_by: string | null };

/**
 * The document text split around a quoted passage. A passage can begin
 * inside a paragraph (passages overlap a little), so it is found by its
 * first and last words rather than as one exact string.
 */
function splitAround(text: string, passage: string | null): { before: string; hit: string; after: string } {
  if (!passage) return { before: text, hit: '', after: '' };
  const head = passage.slice(0, 60);
  const tail = passage.slice(-60);
  const start = text.indexOf(head);
  if (start < 0) return { before: text, hit: '', after: '' };
  const tailAt = text.indexOf(tail, start);
  const end = tailAt >= 0 ? tailAt + tail.length : Math.min(text.length, start + passage.length);
  return { before: text.slice(0, start), hit: text.slice(start, end), after: text.slice(end) };
}

export default function MemoryDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { show, node: toastNode } = useToast();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [passage, setPassage] = useState<string | null>(null);

  useEffect(() => {
    const c = new AbortController();
    const n = window.location.hash.match(/^#passage-(\d+)$/)?.[1];
    api<{ document: Doc; passage: string | null }>(`/api/memory/documents/${id}${n ? `?passage=${n}` : ''}`, { signal: c.signal })
      .then((r) => {
        setDoc(r.document);
        setPassage(r.passage);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load');
      });
    return () => c.abort();
  }, [id]);

  const parts = doc ? splitAround(doc.raw_text, passage) : null;

  useEffect(() => {
    if (parts?.hit) requestAnimationFrame(() => document.getElementById('passage')?.scrollIntoView({ block: 'center' }));
  }, [parts?.hit]);

  const remove = async () => {
    if (!doc || !window.confirm(`Delete "${doc.title}" from memory? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api(`/api/memory/documents/${doc.id}`, { method: 'DELETE' });
      router.push('/memory');
    } catch (e) {
      show(e instanceof Error ? e.message : 'Could not delete', 'err');
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {toastNode}
      <PageHeader title={<Link href="/memory" className="hover:underline">Memory</Link>} className="!px-4 sm:!px-12">
        {doc && (
          <GhostBtn danger onClick={() => void remove()} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </GhostBtn>
        )}
      </PageHeader>
      <div className="flex-1 overflow-y-auto px-4 sm:px-12 pb-16">
        {error ? (
          <p role="alert" className="text-[13px] text-red-400">
            {error}
          </p>
        ) : !doc ? (
          <Loading />
        ) : doc.source === 'note' ? (
          <NoteEditor sourceId={doc.source_id} initialText={doc.raw_text} />
        ) : (
          <article className="flex flex-col gap-6 max-w-3xl">
            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold text-white break-words">{doc.title}</h2>
              <p className="text-xs text-zinc-500 break-words">
                {KIND_LABEL[doc.kind] ?? doc.kind}
                {docDate(doc) && ` · ${docDate(doc)}`} · from {doc.source}
                {doc.added_by && doc.added_by !== 'owner' ? ` (${doc.added_by})` : ''} · added {fmtDate(doc.created_at)}
                {doc.url && (
                  <>
                    {' · '}
                    <a className="underline" href={doc.url} target="_blank" rel="noreferrer">
                      original
                    </a>
                  </>
                )}
              </p>
              {doc.speakers.length > 0 && (
                <p className="text-xs text-zinc-500">
                  Speakers: {doc.speakers.join(', ')}
                  {doc.owner_speaker ? ` · you are ${doc.owner_speaker}` : ''}
                </p>
              )}
            </div>
            {parts && (
              <div className="text-[14px] leading-relaxed whitespace-pre-wrap break-words text-zinc-300">
                {parts.before}
                {parts.hit && (
                  <mark id="passage" className="bg-yellow-500/15 text-white rounded-sm">
                    {parts.hit}
                  </mark>
                )}
                {parts.after}
              </div>
            )}
          </article>
        )}
      </div>
    </div>
  );
}
