'use client';
/**
 * Loads one solo document once, applies edits optimistically and saves the
 * whole document back after a short pause. Saves run one at a time; edits made
 * during a save are sent right after it. A failed save keeps the edit on screen
 * and reports the error until a retry or the next edit succeeds.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadDoc, saveDoc } from '@/lib/solo/client';

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const SAVE_DELAY_MS = 700;

export function useSoloDoc<T extends { updated_at?: string }>(key: string, normalize: (raw: unknown) => T) {
  const [doc, setDoc] = useState<T | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');

  const latest = useRef<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const dirty = useRef(false);

  const fetchDoc = useCallback(async () => normalize(await loadDoc<unknown>(key, null)), [key, normalize]);
  const apply = useCallback((next: T) => { latest.current = next; setDoc(next); }, []);
  const fail = useCallback((e: unknown) => setLoadError((e as Error)?.message || 'Could not load this page.'), []);

  useEffect(() => { fetchDoc().then(apply, fail); }, [fetchDoc, apply, fail]);

  const reload = useCallback(() => { setLoadError(''); fetchDoc().then(apply, fail); }, [fetchDoc, apply, fail]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!latest.current) return;
    if (saving.current) { dirty.current = true; return; }
    saving.current = true;
    setSaveState('saving');
    try {
      do {
        dirty.current = false;
        await saveDoc(key, { ...latest.current, updated_at: new Date().toISOString() });
      } while (dirty.current);
      setSaveError('');
      setSaveState('saved');
    } catch (e) {
      setSaveError((e as Error).message || 'Save failed.');
      setSaveState('error');
    } finally {
      saving.current = false;
    }
  }, [key]);

  const update = useCallback((fn: (d: T) => T) => {
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

  return { doc, loadError, reload, update, saveState, saveError, retrySave: flush };
}

/** A fresh id for a new list entry. */
export function newId(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}
