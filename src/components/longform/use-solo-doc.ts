'use client';
/**
 * Holds one Solo document in memory and saves the whole thing back after each
 * change. Saves run one at a time; if several changes land while a save is in
 * flight, only the newest is written.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadDoc, saveDoc } from '@/lib/solo/client';

export function useSoloDoc<T>(key: string, normalize: (raw: unknown) => T) {
  const [doc, setDoc] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const current = useRef<T | null>(null);
  const queued = useRef<T | null>(null);
  const running = useRef(false);
  const normalizeRef = useRef(normalize);

  useEffect(() => {
    let alive = true;
    loadDoc<unknown>(key, null)
      .then((raw) => {
        if (!alive) return;
        const value = normalizeRef.current(raw);
        current.current = value;
        setDoc(value);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, [key]);

  const flush = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setSaving(true);
    try {
      while (queued.current) {
        const next = queued.current;
        queued.current = null;
        await saveDoc(key, next);
      }
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      running.current = false;
      setSaving(false);
    }
  }, [key]);

  const update = useCallback((change: (prev: T) => T) => {
    if (!current.current) return;
    const next = change(current.current);
    current.current = next;
    queued.current = next;
    setDoc(next);
    void flush();
  }, [flush]);

  return { doc, update, error, saving };
}
