'use client';
/** Progress dial, ported from the Solo OS Ring. value is 0..1. */
import type { ReactNode } from 'react';
import { clamp01 } from './types';

export function Ring({ value, size = 132, stroke = 8, color = 'var(--accent)', children, label }: {
  value: number; size?: number; stroke?: number; color?: string; children?: ReactNode; label?: string;
}) {
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - clamp01(value));
  return (
    <div role="img" aria-label={label ?? `${Math.round(clamp01(value) * 100)}%`}
      style={{ position: 'relative', width: '100%', maxWidth: size, aspectRatio: '1 / 1', flex: '0 0 auto' }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 800ms var(--ease-out)' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        {children}
      </div>
    </div>
  );
}

export function Percent({ value, size }: { value: number; size: number }) {
  return (
    <span style={{ fontWeight: 600, fontSize: size, letterSpacing: '-0.03em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
      {Math.round(clamp01(value) * 100)}
      <span style={{ fontSize: '0.45em', marginLeft: 2, opacity: 0.55, fontWeight: 600 }}>%</span>
    </span>
  );
}
