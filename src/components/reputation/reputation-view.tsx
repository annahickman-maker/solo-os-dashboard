'use client';
/**
 * Reputation tab (/brand/reputation), ported from the old Solo OS Reputation
 * page: score hero, the transformation you want to be known for, the four
 * dimensions as a 2x2 grid, and a slide-over panel per dimension with its
 * fields and banks. Data: solo document `reputation` (./types.ts).
 *
 * The score comes only from POST /api/reputation/analyse, which reads the
 * owner's published content. What is filled in here is the source material
 * the analysis compares against, shown separately as "filled in".
 */
import { useCallback, useState } from 'react';
import { useSoloDoc } from '@/components/brand/use-solo-doc';
import { PrimaryBtn } from '@/components/crm/kit';
import {
  BODY, CARD, CARD_BTN, GRID2, META, PAGE, PAGE_INNER, TITLE, WELL, Bar, LoadState, Panel, Ring, SaveStatus, Section,
  TextArea, TopLine, orNull,
} from '@/components/brand/ui';
import {
  ANALYSIS_KEY, DIMENSIONS, NO_ANALYSIS_LINE, REPUTATION_DOC_KEY, buildCompletion, dimensionScore,
  maturityStage, normalizeContentAnalysis, normalizeReputationDoc, overallScore,
  type ContentAnalysis, type DimensionId, type ReputationDoc,
} from './types';
import { AuthorityPanel, ConnectionPanel, PovPanel, ValuePanel } from './panels';

const FRAMING = 'Claude reads what you have actually published and scores how well each part of your brand comes across in it.';

export type UpdateRep = (fn: (d: ReputationDoc) => ReputationDoc) => void;

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Last run, piece count and the empty-state line. */
function analysisStatus(a: ContentAnalysis | null): string {
  if (!a) return NO_ANALYSIS_LINE;
  if (a.pieces_count === 0) return '';
  const when = formatDate(a.analysed_at);
  return `Last analysed${when ? ` ${when}` : ''} · ${a.pieces_count} published ${a.pieces_count === 1 ? 'piece' : 'pieces'}`;
}

export function ReputationView() {
  const { doc, loadError, reload, update, saveState, saveError, retrySave } = useSoloDoc(REPUTATION_DOC_KEY, normalizeReputationDoc);
  const [openDim, setOpenDim] = useState<DimensionId | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analyseError, setAnalyseError] = useState('');
  const close = useCallback(() => setOpenDim(null), []);

  const analyse = useCallback(async () => {
    setAnalysing(true);
    setAnalyseError('');
    try {
      // Save pending edits first, so the analysis reads them and does not race them.
      if (saveState === 'pending') await retrySave();
      const res = await fetch('/api/reputation/analyse', { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as { analysis?: unknown; error?: string };
      if (!res.ok) throw new Error(json.error || `Analysis failed (${res.status})`);
      const analysis = normalizeContentAnalysis(json.analysis);
      // Keep the new analysis in the page's copy, so the next save carries it.
      update((d) => ({ ...d, content_analysis: analysis }));
    } catch (e) {
      setAnalyseError((e as Error).message || 'Analysis failed.');
    } finally {
      setAnalysing(false);
    }
  }, [saveState, retrySave, update]);

  if (!doc) return <LoadState error={loadError} onRetry={reload} />;

  const analysis = doc.content_analysis;
  const overall = overallScore(doc);
  const stage = maturityStage(overall);
  const dim = DIMENSIONS.find((d) => d.id === openDim) ?? null;

  return (
    <div className={PAGE}>
      <div className={PAGE_INNER}>
        <TopLine><SaveStatus state={saveState} error={saveError} onRetry={retrySave} /></TopLine>

        <section className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 pb-8 sm:pb-10">
          <Ring value={overall / 100} label={overall} size={104} stroke={8} color="var(--so-green)" />
          <div className="flex flex-col gap-2 min-w-0">
            <p className={META}>Stage · {stage.label}</p>
            <h2 className="text-xl font-semibold leading-snug text-white">How well does your published content carry your brand?</h2>
            <p className={BODY}>{FRAMING}</p>
            <div className="flex gap-3 items-center flex-wrap mt-1">
              <PrimaryBtn disabled={analysing} onClick={() => void analyse()}>
                {analysing ? 'Analysing...' : analysis ? 'Analyse again' : 'Analyse my content'}
              </PrimaryBtn>
              <span className={META}>{analysisStatus(analysis)}</span>
            </div>
            {analyseError && <span className="text-xs text-red-400" role="alert">{analyseError}</span>}
          </div>
        </section>

        <section className={`${CARD} flex flex-col gap-4`}>
          <h2 className={TITLE}>The transformation I want to be known for</h2>
          <TextArea large rows={2}
            value={doc.transformation_anchor.positioning_statement}
            placeholder="One powerful sentence that captures the transformation you want to be known for in your industry."
            onChange={(v) => update((d) => ({ ...d, transformation_anchor: { ...d.transformation_anchor, positioning_statement: orNull(v) } }))} />
        </section>

        <div className={GRID2}>
          {DIMENSIONS.map((d) => {
            const score = dimensionScore(doc, d.id);
            return (
              <button key={d.id} type="button" className={CARD_BTN} onClick={() => setOpenDim(d.id)}>
                <div className="flex gap-4 items-center">
                  <Ring value={score / 100} label={score} size={56} color={d.color} stroke={5} />
                  <div className="min-w-0">
                    <h3 className={TITLE}>{d.label}</h3>
                    <p className={`${BODY} mt-1`}>{d.definition.split('.')[0]}.</p>
                  </div>
                </div>
                <Bar value={score / 100} color={d.color} />
                <div className={`flex justify-between gap-2 flex-wrap ${META}`}>
                  <span title="How much of your source material for this is filled in. Not part of the score.">
                    Source material {Math.round(buildCompletion(doc, d.id) * 100)}% filled in
                  </span>
                  <span>Open →</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {dim && (
        <Panel eyebrow="dimension" title={dim.label} sub={dim.definition} color={dim.color} onClose={close}
          aside={<span className="text-2xl font-semibold text-white tabular-nums">{dimensionScore(doc, dim.id)}<span className="text-xs font-normal text-zinc-500"> / 100</span></span>}>
          <InPublishedContent analysis={analysis} dim={dim.id} color={dim.color} />
          {dim.id === 'value' && <ValuePanel doc={doc} update={update} color={dim.color} />}
          {dim.id === 'authority' && <AuthorityPanel doc={doc} update={update} />}
          {dim.id === 'point_of_view' && <PovPanel doc={doc} update={update} />}
          {dim.id === 'connection' && <ConnectionPanel doc={doc} update={update} />}
        </Panel>
      )}
    </div>
  );
}

/** The analysis for one dimension: evidence quotes and the suggestion. */
function InPublishedContent({ analysis, dim, color }: { analysis: ContentAnalysis | null; dim: DimensionId; color: string }) {
  const key = ANALYSIS_KEY[dim];
  const hasRun = !!analysis && analysis.pieces_count > 0;
  const evidence = hasRun ? analysis.evidence[key] : [];
  const suggestion = hasRun ? analysis.suggestions[key] : '';
  return (
    <>
      <Section title="in your published content" sub={hasRun ? analysisStatus(analysis) : undefined}>
        {!hasRun && !analysis && <p className={BODY}>{NO_ANALYSIS_LINE}</p>}
        {hasRun && (
          <>
            {evidence.length === 0
              ? <p className={BODY}>No clear examples found in what you have published yet.</p>
              : (
                <div className="flex flex-col gap-2">
                  {evidence.map((q, i) => (
                    <blockquote key={i} className={`${WELL} m-0 px-4 py-3 border-l-2 text-[14px] text-zinc-300 leading-relaxed`} style={{ borderLeftColor: color }}>
                      &ldquo;{q}&rdquo;
                    </blockquote>
                  ))}
                </div>
              )}
            {suggestion && (
              <div className={`${WELL} px-4 py-3 flex flex-col gap-1`}>
                <span className="text-xs font-medium" style={{ color }}>Next</span>
                <span className="text-[14px] text-white leading-relaxed">{suggestion}</span>
              </div>
            )}
          </>
        )}
      </Section>
      <h3 className={`${META} mt-4`}>Your source material</h3>
    </>
  );
}
