'use client';
/**
 * Short form: Shorts, Reels, TikTok and carousels, idea to posted, with a
 * minimal studio (hooks, caption). A card can point at the long form video it
 * was cut from. Scheduling and publishing stay on /social.
 * Data: Solo document `shortform` (see src/components/shortform/types.ts);
 * reads `longform` only to list videos. Tools: src/components/shortform/studio-tools.ts.
 */
import Link from 'next/link';
import { useState } from 'react';
import { solidButtonStyle } from '@/components/solo/kit';
import { Field, PipelineBoard, newCardBase } from '@/components/longform/pipeline-board';
import { StudioPanel } from '@/components/longform/studio-panel';
import { normalizeLongform, type LongformCard, type LongformDoc } from '@/components/longform/types';
import { useSoloDoc } from '@/components/longform/use-solo-doc';
import { SHORTFORM_STUDIO } from '@/components/shortform/studio-tools';
import {
  SHORTFORM_PLATFORMS, SHORTFORM_STAGES, normalizeShortform,
  type ShortformCard, type ShortformDoc, type ShortformPlatform,
} from '@/components/shortform/types';

const platformLabel = (id: string) => SHORTFORM_PLATFORMS.find((p) => p.id === id)?.label ?? id;

export default function ShortFormPage() {
  const { doc, update, error, saving } = useSoloDoc<ShortformDoc>('shortform', normalizeShortform);
  const { doc: longform } = useSoloDoc<LongformDoc>('longform', normalizeLongform);
  const videos = longform?.cards ?? [];
  const videoById = (id: string | null) => (id ? videos.find((v) => v.id === id) : undefined);

  return (
    <div className="stack wide" style={{ maxWidth: 1080 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow">short form</div>
          <h1 style={{ margin: '4px 0 0', fontSize: 'var(--h3)', fontWeight: 700, letterSpacing: '-0.02em' }}>Shorts, Reels, TikTok, carousels</h1>
        </div>
        <span style={{ fontSize: 'var(--body-sm)', color: error ? 'var(--hrv)' : 'var(--muted)' }}>
          {error || (saving ? 'saving...' : doc ? 'saved' : '')}
        </span>
      </header>

      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>Scheduler and calendar</div>
          <div style={{ color: 'var(--muted)', fontSize: 'var(--body-sm)' }}>When a post is ready, upload and schedule it to your connected accounts.</div>
        </div>
        <Link href="/social" style={{ ...solidButtonStyle, textDecoration: 'none' }}>open the calendar</Link>
      </div>

      {!doc && !error && <div style={{ color: 'var(--muted)', fontSize: 'var(--body-sm)' }}>loading...</div>}
      {doc && (
        <PipelineBoard<ShortformCard>
          stages={SHORTFORM_STAGES}
          cards={doc.cards}
          addPlaceholder="add a short form idea..."
          onAdd={(title) => update((d) => ({
            ...d, cards: [{ ...newCardBase(title, 'idea'), stage: 'idea', platforms: [], longformId: null }, ...d.cards],
          }))}
          onChange={(card) => update((d) => ({ ...d, cards: d.cards.map((c) => (c.id === card.id ? card : c)) }))}
          onDelete={(id) => update((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id) }))}
          renderChips={(card) => (
            <>
              {card.platforms.map((p) => <span key={p} className="pl-chip">{platformLabel(p)}</span>)}
              {videoById(card.longformId) && <span className="pl-chip">from video</span>}
            </>
          )}
          renderEditorExtra={(card, change) => (
            <>
              <Field label="platforms">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {SHORTFORM_PLATFORMS.map((p) => {
                    const on = card.platforms.includes(p.id);
                    const next: ShortformPlatform[] = on ? card.platforms.filter((x) => x !== p.id) : [...card.platforms, p.id];
                    return (
                      <button key={p.id} type="button" aria-pressed={on} onClick={() => change({ platforms: next })}
                        style={{
                          padding: '6px 14px', borderRadius: 'var(--radius-pill)', fontSize: 'var(--body-sm)', fontWeight: on ? 600 : 500,
                          cursor: 'pointer', border: '1px solid transparent', boxShadow: 'var(--lift)', fontFamily: 'inherit',
                          background: on ? 'var(--so-primary)' : 'var(--so-well)', color: on ? 'var(--so-primary-ink)' : 'var(--so-muted)',
                        }}>{p.label}</button>
                    );
                  })}
                </div>
              </Field>
              <Field label="from long form video">
                <select className="input" value={card.longformId ?? ''} onChange={(e) => change({ longformId: e.target.value || null })}>
                  <option value="">none</option>
                  {videos.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
                </select>
              </Field>
              {videoById(card.longformId) && (
                <Link href="/long-form" style={{ fontSize: 'var(--body-sm)', color: 'var(--muted)' }}>open long form board</Link>
              )}
            </>
          )}
          renderStudio={(card, change) => (
            <ShortStudio card={card} videos={videos} onChange={change} />
          )}
        />
      )}
    </div>
  );
}

/** Studio with a source picker: this card, or any long form video (defaults to the linked one). */
function ShortStudio({ card, videos, onChange }: {
  card: ShortformCard; videos: LongformCard[]; onChange: (patch: Partial<ShortformCard>) => void;
}) {
  const [sourceId, setSourceId] = useState(card.longformId ?? '');
  const video = videos.find((v) => v.id === sourceId);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <Field label="write from">
        <select className="input" value={video ? sourceId : ''} onChange={(e) => setSourceId(e.target.value)}>
          <option value="">this card</option>
          {videos.map((v) => <option key={v.id} value={v.id}>long form: {v.title}</option>)}
        </select>
      </Field>
      <StudioPanel
        config={SHORTFORM_STUDIO}
        source={{
          title: card.title,
          notes: card.notes,
          platforms: card.platforms.map(platformLabel),
          ...(video ? { fromVideo: { title: video.title, notes: video.notes } } : {}),
        }}
        saved={card.studio ?? {}}
        onSaved={(toolId, options) => onChange({ studio: { ...card.studio, [toolId]: options } })}
        onUseTitle={(title) => onChange({ title })}
      />
    </div>
  );
}
