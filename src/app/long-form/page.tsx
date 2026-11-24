'use client';
/**
 * Long form: the YouTube video pipeline, idea to published, with a minimal
 * studio on each card (titles, hook, description). Data: Solo document
 * `longform` (see src/components/longform/types.ts). Studio tools come from
 * src/components/longform/studio-tools.ts; see STUDIO.md to add more.
 */
import { PipelineBoard, newCardBase } from '@/components/longform/pipeline-board';
import { StudioPanel } from '@/components/longform/studio-panel';
import { LONGFORM_STUDIO } from '@/components/longform/studio-tools';
import { LONGFORM_STAGES, normalizeLongform, type LongformCard, type LongformDoc } from '@/components/longform/types';
import { useSoloDoc } from '@/components/longform/use-solo-doc';

export default function LongFormPage() {
  const { doc, update, error, saving } = useSoloDoc<LongformDoc>('longform', normalizeLongform);

  return (
    <div className="stack wide" style={{ maxWidth: 1080 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow">long form</div>
          <h1 style={{ margin: '4px 0 0', fontSize: 'var(--h3)', fontWeight: 700, letterSpacing: '-0.02em' }}>YouTube videos</h1>
        </div>
        <span style={{ fontSize: 'var(--body-sm)', color: error ? 'var(--hrv)' : 'var(--muted)' }}>
          {error || (saving ? 'saving...' : doc ? 'saved' : '')}
        </span>
      </header>

      {!doc && !error && <div style={{ color: 'var(--muted)', fontSize: 'var(--body-sm)' }}>loading...</div>}
      {doc && (
        <PipelineBoard<LongformCard>
          stages={LONGFORM_STAGES}
          cards={doc.cards}
          addPlaceholder="add a video idea..."
          onAdd={(title) => update((d) => ({ ...d, cards: [{ ...newCardBase(title, 'idea'), stage: 'idea' }, ...d.cards] }))}
          onChange={(card) => update((d) => ({ ...d, cards: d.cards.map((c) => (c.id === card.id ? card : c)) }))}
          onDelete={(id) => update((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id) }))}
          renderStudio={(card, change) => (
            <StudioPanel
              config={LONGFORM_STUDIO}
              source={{ title: card.title, notes: card.notes }}
              saved={card.studio ?? {}}
              onSaved={(toolId, options) => change({ studio: { ...card.studio, [toolId]: options } })}
              onUseTitle={(title) => change({ title })}
            />
          )}
        />
      )}
    </div>
  );
}
