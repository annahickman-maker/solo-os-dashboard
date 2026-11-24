'use client';
/**
 * "Connecting to your offer": shows the focus offer (the featured offer in the
 * `offer` document) under the 90-day statement, with a picker of every offer.
 * Picking one sets it as the focus in the offer document, so the Offer tab's
 * "make focus" shows the same choice. Its targets are set from the
 * "set target" panel (./target-panel.tsx). See ./offer-link.ts for the data rules.
 */
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { STAGE_META, type OfferDoc } from '@/components/offer/types';
import { focusOffer, offerName } from './offer-link';

const OFFER_HREF = '/brand/offer';

export function OfferConnector({ doc, loadError, onPick }: {
  doc: OfferDoc | null; loadError: string;
  onPick: (rungId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (loadError) {
    return (
      <div className="flex flex-col gap-2">
                <div className="border border-dashed border-minimal-border rounded-lg px-4 py-4 text-[13px] text-red-400" role="alert">
          Could not load your offers: {loadError}
        </div>
      </div>
    );
  }
  if (!doc) return null;

  const rung = focusOffer(doc);
  const rungs = [...doc.rungs].sort((a, b) => Number(b.featured) - Number(a.featured) || a.sort_order - b.sort_order);
  const pick = (id: string | null) => { onPick(id); setOpen(false); };

  return (
    <div className="relative flex flex-col gap-2" ref={ref}>
      <div className="flex items-center justify-between gap-2">
                <Link href={OFFER_HREF} className="text-xs text-zinc-500 hover:text-white transition-colors">Open offer →</Link>
      </div>
      {rung ? (
        <button type="button" aria-haspopup="listbox" aria-expanded={open} title="change the focus offer" onClick={() => setOpen(!open)}
          className="w-full min-h-11 flex items-center gap-3 px-4 py-3 border border-minimal-border rounded-lg text-left hover:border-zinc-500 transition-colors">
          <span className="text-green-500 shrink-0" aria-hidden>★</span>
          <span className="flex flex-col gap-0.5 min-w-0 flex-1">
            <span className="text-[14px] font-medium text-white truncate">{offerName(rung)}</span>
            <span className="text-xs text-zinc-500 truncate">
              {[rung.price_label.trim(), `Stage: ${STAGE_META[rung.status].label.toLowerCase()}`].filter(Boolean).join(' · ')}
            </span>
          </span>
          <span className="text-xs text-zinc-500 shrink-0">Change</span>
        </button>
      ) : (
        <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}
          className="w-full min-h-11 px-4 py-4 border border-dashed border-zinc-600 rounded-lg text-[13px] text-zinc-500 text-center hover:text-white hover:border-zinc-500 transition-colors">
          ★ Select your focus offer · this is what you are building these 90 days
        </button>
      )}

      {open && (
        <div role="listbox" aria-label="pick a focus offer"
          className="absolute top-full left-0 right-0 mt-1 z-30 flex flex-col max-h-80 overflow-y-auto p-1.5 border border-minimal-border rounded-lg bg-minimal-bg shadow-xl">
          {rungs.length === 0 ? (
            <div className="p-2.5 text-[13px] text-zinc-500">
              No offers yet. <Link href={OFFER_HREF} className="underline hover:text-white">Add one on the Offer tab</Link>.
            </div>
          ) : rungs.map((r) => (
            <button key={r.id} type="button" role="option" aria-selected={r.featured} onClick={() => pick(r.id)}
              className={`flex items-center gap-2 w-full min-h-11 px-2.5 py-2 rounded-md text-left text-[14px] hover:bg-minimal-row ${r.featured ? 'bg-minimal-row text-white' : 'text-zinc-300'}`}>
              <span className="w-3.5 text-green-500" aria-hidden>{r.featured ? '★' : ''}</span>
              <span className="flex flex-col gap-0.5 min-w-0 flex-1">
                <span className="font-medium truncate">{offerName(r)}</span>
                <span className="text-xs text-zinc-500 truncate">{[r.price_label.trim(), STAGE_META[r.status].label.toLowerCase()].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          ))}
          {rung && (
            <button type="button" onClick={() => pick(null)}
              className="flex items-center gap-2 w-full min-h-11 px-2.5 py-2 rounded-md text-left text-[14px] text-zinc-400 hover:bg-minimal-row">
              <span className="w-3.5" />No focus offer
            </button>
          )}
        </div>
      )}
    </div>
  );
}
