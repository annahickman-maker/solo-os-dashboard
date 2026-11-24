'use client';

/** Setup card: turn the optional rooms on or off. Saves the solo doc `nav`. */
import { useEffect, useState } from 'react';
import { loadDoc, saveDoc } from '@/lib/solo/client';
import {
  DEFAULT_NAV_MODULES,
  MODULE_NAV,
  NAV_CHANGED_EVENT,
  normalizeNavDoc,
  type NavDoc,
  type NavModuleKey,
  type NavModules,
} from '@/components/nav';

const HINTS: Record<NavModuleKey, string> = {
  leads: 'Everyone with an email: subscribers, buyers and bookers.',
  pipeline: 'Deals by stage. Bookings and enquiries land here automatically.',
  email: 'Email sequences and broadcasts.',
  analytics: 'Visits, sign-ups and sales over time.',
  sales: 'Products, orders and digital delivery for your sales page.',
};

export default function NavModulesCard({ onNotify }: { onNotify: (m: string, kind?: 'ok' | 'err') => void }) {
  const [modules, setModules] = useState<NavModules>(DEFAULT_NAV_MODULES);
  const [doc, setDoc] = useState<Record<string, unknown>>({});
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState<NavModuleKey | null>(null);

  useEffect(() => {
    let live = true;
    loadDoc<Record<string, unknown> | null>('nav', null)
      .then((d) => {
        if (!live) return;
        setDoc(d ?? {});
        setModules(normalizeNavDoc(d).modules);
      })
      .catch(() => {})
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);

  const toggle = async (key: NavModuleKey) => {
    const prev = modules;
    const next = { ...modules, [key]: !modules[key] };
    const nextDoc: NavDoc & Record<string, unknown> = { ...doc, modules: next };
    setModules(next);
    setSaving(key);
    try {
      await saveDoc('nav', nextDoc);
      setDoc(nextDoc);
      window.dispatchEvent(new CustomEvent(NAV_CHANGED_EVENT, { detail: nextDoc }));
      onNotify('Saved');
    } catch (e) {
      setModules(prev);
      onNotify(e instanceof Error ? e.message : 'Save failed', 'err');
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="border border-minimal-border rounded-lg p-6 flex flex-col gap-4">
      <div>
        <h2 className="text-[13px] font-semibold text-zinc-300">Modules</h2>
        <p className="text-xs text-zinc-500 mt-1">
          Choose which optional rooms appear in your navigation. Focus, Content, Brand, Memory and Library are always
          there. Turning one off only hides it; its data stays.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {MODULE_NAV.map((item) => (
          <button
            key={item.module}
            type="button"
            role="switch"
            aria-checked={modules[item.module]}
            disabled={!ready || saving !== null}
            onClick={() => toggle(item.module)}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-minimal-row transition-colors disabled:opacity-60"
          >
            <span className="flex flex-col">
              <span className="text-[14px] font-medium text-white">{item.setupLabel}</span>
              <span className="text-xs text-zinc-500">{HINTS[item.module]}</span>
            </span>
            <span className={`so-switch ${modules[item.module] ? 'on' : ''}`} />
          </button>
        ))}
      </div>
    </section>
  );
}
