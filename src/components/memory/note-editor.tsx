'use client';

/**
 * A notepad that saves itself. One clean writing surface with light
 * formatting by keyboard only, no toolbar: Cmd+B bold, "- " bullets,
 * "1. " numbered list, "## " heading. The first line is the title, everything saves a moment after you stop typing, and there is no
 * Save button. A note keeps one source id, so each save updates the same
 * document instead of adding a copy.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { marked } from 'marked';
import { api } from '@/components/crm/kit';
import { titleFromMarkdown, toMarkdown, type PmNode } from './note-markdown';

const SAVE_AFTER_MS = 900;

export function newNoteId(): string {
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type State = 'idle' | 'saving' | 'saved' | 'error';

export function NoteEditor({ sourceId, initialText = '' }: { sourceId: string; initialText?: string }) {
  const [text, setText] = useState(initialText);
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false })],
    content: initialText ? (marked.parse(initialText, { async: false }) as string) : '',
    immediatelyRender: false,
    autofocus: 'end',
    editorProps: {
      attributes: {
        class: 'note-prose min-h-[65vh] focus:outline-none text-[16px] leading-[1.7] text-zinc-100',
        'aria-label': 'Note',
      },
      handleKeyDown: (_view, e) => {
        if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void saveRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => setText(ed.isEmpty ? '' : toMarkdown(ed.getJSON() as PmNode)),
  });
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState('');
  const saved = useRef(initialText);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(text);
  useEffect(() => {
    latest.current = text;
  }, [text]);
  const [savedText, setSavedText] = useState(initialText);

  const save = useCallback(async () => {
    const body = latest.current;
    if (!body.trim() || body === saved.current) return;
    setState('saving');
    try {
      await api('/api/memory/documents', {
        method: 'POST',
        body: JSON.stringify({ source: 'note', source_id: sourceId, kind: 'note', title: titleFromMarkdown(body), text: body }),
      });
      saved.current = body;
      setSavedText(body);
      setState(latest.current === body ? 'saved' : 'idle');
      setError('');
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  }, [sourceId]);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(() => {
    if (text === saved.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_AFTER_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text, save]);

  // Save on leaving the page or hiding the tab.
  useEffect(() => {
    const flush = () => void save();
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [save]);

  const label =
    state === 'saving' ? 'Saving…' : state === 'error' ? `Not saved: ${error}` : text !== savedText ? '' : state === 'saved' ? 'Saved' : '';

  return (
    <div className="flex flex-col gap-2 max-w-3xl h-full">
      <div className="h-5 text-xs text-right" aria-live="polite">
        <span className={state === 'error' ? 'text-red-400' : 'text-zinc-500'}>{label}</span>
        {state === 'error' && (
          <button type="button" className="ml-2 underline text-zinc-400" onClick={() => void save()}>
            try again
          </button>
        )}
      </div>
      <EditorContent editor={editor} className="flex-1" />
    </div>
  );
}
