'use client';

import * as React from 'react';
import { Quality, QUALITY_LABELS, QUALITY_DESCRIPTIONS } from './types';

// ── Generic popup wrapper ─────────────────────────────────────────────────────

function Popup({ label, ariaLabel, minWidth, children }: {
  label: string;
  ariaLabel: string;
  minWidth?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={ariaLabel}
        aria-expanded={open}
        style={{
          width: 16, height: 16, padding: 0, fontSize: '0.65rem', lineHeight: 1,
          border: '1px solid currentColor', borderRadius: '50%',
          background: 'transparent', cursor: 'pointer', color: 'var(--bs-secondary)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        ?
      </button>
      {open && (
        <div style={{
          position: 'absolute', zIndex: 1060, top: '120%', left: 0,
          minWidth: minWidth ?? 320, background: 'var(--bs-body-bg)',
          border: '1px solid var(--bs-border-color)', borderRadius: '0.375rem',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: '0.6rem 0.75rem',
        }}>
          <div className="d-flex align-items-center justify-content-between mb-2">
            <span className="small fw-semibold">{label}</span>
            <button type="button" className="btn-close btn-close-sm" aria-label="Close" onClick={() => setOpen(false)} style={{ fontSize: '0.65rem' }} />
          </div>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Exported help buttons ─────────────────────────────────────────────────────

const FILTER_HELP = [
  { label: '⚠ Attention needed', desc: 'At least one scan room is missing an image.' },
  { label: '⚡ Fix potential',    desc: 'At least one scan room has no image AND at least one unmapped CR-API room has an image — a potential source to fill the gap.' },
];

export function FilterHelpButton() {
  return (
    <Popup label="Filter options" ariaLabel="What do filter options mean?" minWidth={320}>
      <ul className="list-unstyled mb-0 small">
        {FILTER_HELP.map(f => (
          <li key={f.label} className="mb-1">
            <span className="fw-semibold">{f.label}:</span>{' '}
            <span className="text-muted">{f.desc}</span>
          </li>
        ))}
      </ul>
    </Popup>
  );
}

export function QualityHelpButton() {
  return (
    <Popup label="Mapping quality levels" ariaLabel="What do quality levels mean?" minWidth={340}>
      <ul className="list-unstyled mb-0 small">
        {(['perfect', 'verygood', 'good', 'mediocre', 'poor', 'horrible', 'unavailable'] as Quality[]).map(q => (
          <li key={q} className="mb-1">
            <span className="fw-semibold">{QUALITY_LABELS[q]}:</span>{' '}
            <span className="text-muted">{QUALITY_DESCRIPTIONS[q]}</span>
          </li>
        ))}
      </ul>
    </Popup>
  );
}
