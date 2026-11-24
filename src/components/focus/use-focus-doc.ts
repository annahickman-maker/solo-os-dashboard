'use client';
/**
 * Loads the `focus` document once, applies edits optimistically and saves the
 * whole document back after a short pause. Saves run one at a time; edits made
 * during a save are sent right after it. A failed save keeps the edit on screen
 * and reports the error until a retry or the next edit succeeds.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadDoc, saveDoc } from '@/lib/solo/client';
import { DEFAULT_FOCUS_DOC, FOCUS_DOC_KEY, normalizeFocusDoc, type FocusDoc } from './types';

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const SAVE_DELAY_MS = 700;

export function useFocusDoc() {
  const [doc, setDoc] = useState<FocusDoc | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');

  const latest = useRef<FocusDoc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const dirty = useRef(false);

  const fetchDoc = useCallback(() => loadDoc<unknown>(FOCUS_DOC_KEY, DEFAULT_FOCUS_DOC).then(
    (raw) => { const next = normalizeFocusDoc(raw); latest.current = next; setDoc(next); setLoadError(''); },
    (e: Error) => setLoadError(e.message || 'Could not load your focus plan.'),
  ), []);

  useEffect(() => { void fetchDoc(); }, [fetchDoc]);

  const load = useCallback(() => { setLoadError(''); return fetchDoc(); }, [fetchDoc]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!latest.current) return;
    if (saving.current) { dirty.current = true; return; }
    saving.current = true;
    setSaveState('saving');
    try {
      // Keep saving until no edit arrived during the last request.
      do {
        dirty.current = false;
        await saveDoc(FOCUS_DOC_KEY, latest.current);
      } while (dirty.current);
      setSaveError('');
      setSaveState('saved');
    } catch (e) {
      setSaveError((e as Error).message || 'Save failed.');
      setSaveState('error');
    } finally {
      saving.current = false;
    }
  }, []);

  const update = useCallback((fn: (d: FocusDoc) => FocusDoc) => {
    const base = latest.current;
    if (!base) return;
    const next = fn(base);
    if (next === base) return;
    latest.current = next;
    setDoc(next);
    setSaveState('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, SAVE_DELAY_MS);
  }, [flush]);

  // Send a pending edit when the page goes away or is hidden.
  useEffect(() => {
    const onHide = () => { if (timer.current) void flush(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') onHide(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      onHide();
    };
  }, [flush]);

  return { doc, loadError, reload: load, update, saveState, saveError, retrySave: flush };
}
