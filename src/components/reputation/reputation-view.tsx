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
import Link from 'next/link';
import { useSoloDoc } from '@/components/brand/use-solo-doc';
import { Bar, EMPTY_STATE, LoadState, Panel, Ring, SaveStatus, Section, TextArea, orNull } from '@/components/brand/ui';
import {
  ANALYSIS_KEY, DIMENSIONS, NO_ANALYSIS_LINE, NO_CONTENT_LINE, REPUTATION_DOC_KEY, buildCompletion, dimensionScore,
  isReputationEmpty, maturityStage, normalizeContentAnalysis, normalizeReputationDoc, overallScore,
  type ContentAnalysis, type DimensionId, type ReputationDoc,
} from './types';
import { AuthorityPanel, ConnectionPanel, PovPanel, ValuePanel } from './panels';

const FRAMING = 'Claude reads what you have actually published and scores how well each part of your brand comes across in it. What you fill in below is your source material: the target, not the score.';

export type UpdateRep = (fn: (d: ReputationDoc) => ReputationDoc) => void;

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Last run, piece count and the empty-state line. */
function analysisStatus(a: ContentAnalysis | null): string {
  if (!a) return NO_ANALYSIS_LINE;
  if (a.pieces_count === 0) return NO_CONTENT_LINE;
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
    <div className="stack">
      <div className="bp-topline">
        {isReputationEmpty(doc) ? <span className="bp-muted">{EMPTY_STATE}</span> : <span />}
        <SaveStatus state={saveState} error={saveError} onRetry={retrySave} />
      </div>

      <section className="bp-hero">
        <Ring value={overall / 100} label={overall} size={104} stroke={8} color="var(--so-green)" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <span className="so-label" style={{ color: 'var(--so-label)' }}>stage · {stage.label.toLowerCase()}</span>
          <h2 style={{ margin: 0 }}>How well does your published content carry your brand?</h2>
          <p className="bp-muted">{FRAMING}</p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="bp-btn primary" disabled={analysing} onClick={() => void analyse()}>
              {analysing ? 'Analysing...' : analysis ? 'Analyse again' : 'Analyse my content'}
            </button>
            <span className="bp-faint">{analysisStatus(analysis)}</span>
          </div>
          {analysis?.pieces_count === 0 && (
            <span className="bp-faint">Add transcripts and posts in <Link href="/memory" style={{ textDecoration: 'underline' }}>Memory</Link> with the kind set to content.</span>
          )}
          {analyseError && <span className="bp-faint" role="alert" style={{ color: 'var(--so-red)' }}>{analyseError}</span>}
        </div>
      </section>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span className="so-label" style={{ color: 'var(--so-green)' }}>the transformation I want to be known for</span>
        <TextArea large rows={2}
          value={doc.transformation_anchor.positioning_statement}
          placeholder="One powerful sentence that captures the transformation you want to be known for in your industry."
          onChange={(v) => update((d) => ({ ...d, transformation_anchor: { ...d.transformation_anchor, positioning_statement: orNull(v) } }))} />
      </section>

      <div className="bp-grid2">
        {DIMENSIONS.map((d) => {
          const score = dimensionScore(doc, d.id);
          return (
            <button key={d.id} type="button" className="bp-tile" onClick={() => setOpenDim(d.id)}>
              <div className="bp-tile-row">
                <Ring value={score / 100} label={score} size={56} color={d.color} stroke={5} />
                <div style={{ minWidth: 0 }}>
                  <div className="so-label" style={{ color: d.color }}>{d.label.toLowerCase()}</div>
                  <p style={{ marginTop: 4 }}>{d.definition.split('.')[0]}.</p>
                </div>
              </div>
              <Bar value={score / 100} color={d.color} />
              <div className="bp-meta">
                <span title="How much of your source material for this is filled in. Not part of the score.">
                  source material {Math.round(buildCompletion(doc, d.id) * 100)}% filled in
                </span>
                <span>open →</span>
              </div>
            </button>
          );
        })}
      </div>

      {dim && (
        <Panel eyebrow="dimension" title={dim.label.toLowerCase()} sub={dim.definition} color={dim.color} onClose={close}
          aside={<span style={{ fontSize: 22, fontWeight: 600 }}>{dimensionScore(doc, dim.id)}<span className="bp-faint"> / 100</span></span>}>
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
    <Section title="in your published content" sub={hasRun ? analysisStatus(analysis) : undefined}>
      {!hasRun && <p className="bp-muted">{analysis ? NO_CONTENT_LINE : NO_ANALYSIS_LINE}</p>}
      {hasRun && (
        <>
          {evidence.length === 0
            ? <p className="bp-muted">No clear examples found in what you have published yet.</p>
            : (
              <div className="bp-list">
                {evidence.map((q, i) => (
                  <blockquote key={i} className="bp-card" style={{ margin: 0, borderLeft: `3px solid ${color}`, fontSize: 14 }}>
                    &ldquo;{q}&rdquo;
                  </blockquote>
                ))}
              </div>
            )}
          {suggestion && (
            <div className="bp-card">
              <span className="so-label" style={{ color }}>next</span>
              <span style={{ fontSize: 14 }}>{suggestion}</span>
            </div>
          )}
        </>
      )}
      <span className="so-label" style={{ color: 'var(--so-label)', marginTop: 8 }}>your source material</span>
    </Section>
  );
}
