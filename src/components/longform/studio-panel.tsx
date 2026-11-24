'use client';
/**
 * Minimal content generation studio: one button per StudioTool, results saved
 * on the card. Used by both the long form and short form boards. The tool list
 * comes from studio-tools.ts; see STUDIO.md for adding tools.
 */
import { useState } from 'react';
import { ghostButtonStyle, solidButtonStyle } from '@/components/solo/kit';
import type { StudioConfig } from './studio-tools';

export interface StudioPanelSource {
  title: string;
  notes: string;
  platforms?: string[];
  fromVideo?: { title: string; notes: string };
}

export function StudioPanel({ config, source, saved, onSaved, onUseTitle }: {
  config: StudioConfig;
  source: StudioPanelSource;
  saved: Record<string, string[]>;
  onSaved: (toolId: string, options: string[]) => void;
  onUseTitle: (title: string) => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [keyMissing, setKeyMissing] = useState(false);

  const run = async (toolId: string) => {
    if (busy) return;
    setBusy(toolId); setError('');
    try {
      const res = await fetch('/api/studio/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: config.board, tool: toolId, source }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.code === 'AI_KEY_MISSING') { setKeyMissing(true); return; }
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      onSaved(toolId, body.options as string[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div className="eyebrow">studio</div>
      {keyMissing && (
        <div className="card" style={{ borderColor: 'var(--hrv)', fontSize: 'var(--body-sm)' }}>
          Add your AI key in Setup to use the studio. It needs ANTHROPIC_API_KEY.
        </div>
      )}
      {error && <div style={{ color: 'var(--hrv)', fontSize: 'var(--body-sm)' }}>{error}</div>}
      {config.tools.map((tool) => {
        const options = saved[tool.id] ?? [];
        return (
          <div key={tool.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--body-sm)' }}>{tool.label}</div>
                <div style={{ color: 'var(--muted)', fontSize: 'var(--body-sm)' }}>{tool.description}</div>
              </div>
              <button type="button" style={options.length ? ghostButtonStyle : solidButtonStyle} disabled={!!busy} onClick={() => run(tool.id)}>
                {busy === tool.id ? 'writing...' : options.length ? 'regenerate' : 'generate'}
              </button>
            </div>
            {options.map((opt, i) => (
              <div key={i} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', borderTop: '1px solid var(--hairline)', paddingTop: 'var(--space-2)' }}>
                <p className="prose" style={{ flex: 1, minWidth: 0, fontSize: 'var(--body-sm)' }}>{opt}</p>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {tool.applyTo === 'title' && (
                    <button type="button" style={ghostButtonStyle} onClick={() => onUseTitle(opt)}>use</button>
                  )}
                  <CopyButton text={opt} />
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" style={ghostButtonStyle}
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ } }}>
      {done ? 'copied' : 'copy'}
    </button>
  );
}
