'use client';
/**
 * Solo OS components, ported from ~/Projects/solo-os/frontend/src/components.
 * Same locked specs as docs/DESIGN_UI.md (Rules 1, 3 and 6). Change a look here
 * and every Solo page changes together.
 */
import type { CSSProperties, ReactNode } from 'react';

export const SURFACE_LIFT = 'var(--lift)';

// Primary button: Solo OS theme v4 (2026-11-22) replaced the cream + ink border.
export const solidButtonStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
  padding: '8px 16px', borderRadius: 'var(--radius-md)', fontSize: 'var(--body-sm)', fontWeight: 600,
  cursor: 'pointer', background: 'var(--so-primary)', color: 'var(--so-primary-ink)', border: '1px solid transparent',
  whiteSpace: 'nowrap', boxShadow: SURFACE_LIFT,
};

// Rule 6: GHOST button.
export const ghostButtonStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 'var(--radius-md)', fontSize: 'var(--body-sm)', fontWeight: 600,
  cursor: 'pointer', background: 'var(--so-well)', color: 'var(--so-t2)', border: '1px solid transparent',
  whiteSpace: 'nowrap', boxShadow: SURFACE_LIFT,
};

export interface FilterTabOption { value: string; label: ReactNode; count?: number | string }

// Rule 1: the one canonical filter selector.
export function FilterTabs({ options, value, onChange, ariaLabel }: {
  options: FilterTabOption[]; value: string; onChange: (value: string) => void; ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button key={opt.value} type="button" role="tab" aria-selected={active} onClick={() => onChange(opt.value)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 14px',
              borderRadius: 'var(--radius-pill)', fontSize: 'var(--body-sm)', fontWeight: active ? 600 : 500,
              cursor: 'pointer', background: active ? 'var(--so-primary)' : 'var(--so-well)',
              color: active ? 'var(--so-primary-ink)' : 'var(--so-muted)',
              border: '1px solid transparent', boxShadow: SURFACE_LIFT,
              transition: 'all var(--duration-fast) var(--ease-out)', fontFamily: 'inherit',
            }}>
            {opt.label}
            {opt.count !== undefined && <span style={{ opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>{opt.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// Rule 3: section heading - small uppercase eyebrow, optional sub-line, round count badge.
export function SectionHeading({ label, count, sub, color }: { label: string; count?: number; sub?: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div>
        <div className="eyebrow" style={color ? { color } : undefined}>{label}</div>
        {sub && <div style={{ fontSize: 'var(--body-sm)', color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
      </div>
      {count !== undefined && (
        <span style={{
          width: 26, height: 26, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--fill-subtle)', border: '1px solid var(--hairline)', boxShadow: SURFACE_LIFT,
          color: 'var(--muted)', fontSize: 'var(--eyebrow)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', flex: '0 0 auto',
        }}>{count}</span>
      )}
    </div>
  );
}
