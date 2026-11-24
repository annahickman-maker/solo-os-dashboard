'use client';

/**
 * Ask your memory: a question in, an answer grounded in your own words out,
 * with the passages it came from. "Search only" skips Claude (free).
 */
import { Fragment, useState } from 'react';
import Link from 'next/link';
import { api } from '@/components/crm/kit';
import { solidButtonStyle } from '@/components/solo/kit';
import { docDate, docHref, KIND_LABEL, type Hit, type Source } from './types';

type Answer = { answer: string; found: boolean; used: number[]; sources: Source[]; mode: string };

/** "You said X [1][2]." with each [n] linked to its source below. */
function Cited({ text, sources }: { text: string; sources: Source[] }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const n = part.match(/^\[(\d+)\]$/)?.[1];
        const source = n ? sources.find((s) => s.number === Number(n)) : undefined;
        if (!source) return <Fragment key={i}>{part}</Fragment>;
        return (
          <a key={i} href={`#source-${source.number}`} className="text-[11px] align-super text-zinc-400 hover:text-white no-underline">
            [{source.number}]
          </a>
        );
      })}
    </>
  );
}

function SourceRow({ s, used }: { s: Source | (Hit & { number: number }); used?: boolean }) {
  return (
    <li id={`source-${s.number}`} className={`px-4 py-3 flex gap-3 ${used === false ? 'opacity-60' : ''}`}>
      <span className="text-xs text-zinc-500 tabular-nums w-6 shrink-0 pt-[2px]">{s.number}</span>
      <div className="min-w-0 flex-1">
        <Link href={docHref(s.document_id, s.chunk_index)} className="text-[14px] text-white hover:underline break-words">
          {s.title}
        </Link>
        <p className="text-xs text-zinc-500">
          {KIND_LABEL[s.kind] ?? s.kind}
          {docDate(s) && ` · ${docDate(s)}`}
          {s.url && (
            <>
              {' · '}
              <a className="underline" href={s.url} target="_blank" rel="noreferrer">
                original
              </a>
            </>
          )}
        </p>
        <p className="text-[13px] text-zinc-400 mt-1 leading-relaxed break-words">{s.snippet}</p>
      </div>
    </li>
  );
}

export function AskPanel() {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState<'' | 'ask' | 'search'>('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [hits, setHits] = useState<{ mode: string; results: Hit[] } | null>(null);
  const [error, setError] = useState('');
  const [keyMissing, setKeyMissing] = useState(false);

  const search = async () => {
    const q = question.trim();
    if (q.length < 2) return;
    setBusy('search');
    setError('');
    setAnswer(null);
    try {
      setHits(await api<{ mode: string; results: Hit[] }>(`/api/memory/search?q=${encodeURIComponent(q)}&limit=12`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setBusy('');
    }
  };

  const ask = async () => {
    const q = question.trim();
    if (q.length < 3) return;
    setBusy('ask');
    setError('');
    setHits(null);
    setAnswer(null);
    try {
      const res = await fetch('/api/memory/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'AI_KEY_MISSING') {
          setKeyMissing(true);
          setError(data.error);
          setBusy('');
          await search();
          return;
        }
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      setAnswer(data as Answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not answer');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void (keyMissing ? search() : ask());
        }}
      >
        <div className="lib-bar">
          <input
            className="input"
            type="search"
            value={question}
            maxLength={1000}
            placeholder="what have I said about pricing?"
            aria-label="Your question"
            enterKeyHint="search"
            autoFocus
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button type="submit" style={solidButtonStyle} disabled={!!busy || question.trim().length < 2}>
            {busy ? 'Reading…' : keyMissing ? 'Search' : 'Ask'}
          </button>
        </div>
        {!keyMissing && question.trim().length >= 2 && (
          <button
            type="button"
            className="self-start text-xs text-zinc-500 underline"
            disabled={!!busy}
            onClick={() => void search()}
          >
            just show matching passages
          </button>
        )}
      </form>

      {error && (
        <p role="alert" className={`text-[13px] ${keyMissing ? 'text-yellow-400' : 'text-red-400'}`}>
          {error}
        </p>
      )}

      {answer && (
        <div className="flex flex-col gap-3 fade-in">
          <div className="border border-minimal-border rounded-lg p-4 text-[14px] text-white leading-relaxed whitespace-pre-wrap break-words">
            <Cited text={answer.answer} sources={answer.sources} />
          </div>
          {answer.mode === 'keywords' && (
            <p className="text-xs text-zinc-500">Found by keywords only (no embeddings here). Try the words you would have used.</p>
          )}
          {answer.sources.length > 0 && (
            <>
              <h3 className="text-xs font-semibold text-zinc-400">Sources</h3>
              <ul className="border border-minimal-border rounded-lg divide-y divide-minimal-border">
                {answer.sources.map((s) => (
                  <SourceRow key={s.number} s={s} used={answer.used.length ? answer.used.includes(s.number) : undefined} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {hits && (
        <div className="flex flex-col gap-2 fade-in">
          <p className="text-xs text-zinc-500">
            {hits.results.length ? `${hits.results.length} passages` : 'No passages match.'}
            {hits.mode === 'keywords' ? ' · keywords only' : ' · by meaning and keywords'}
          </p>
          {hits.results.length > 0 && (
            <ul className="border border-minimal-border rounded-lg divide-y divide-minimal-border">
              {hits.results.map((h, i) => (
                <SourceRow key={`${h.document_id}-${h.chunk_index}`} s={{ ...h, number: i + 1 }} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
