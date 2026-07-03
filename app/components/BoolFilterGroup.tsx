'use client';

export type FilterBool = 'all' | 'true' | 'false';

interface BoolFilterGroupProps {
  label: string;
  value: FilterBool;
  onChange: (value: FilterBool) => void;
}

const OPTIONS: { value: FilterBool; label: string }[] = [
  { value: 'all',   label: 'All' },
  { value: 'true',  label: 'Yes' },
  { value: 'false', label: 'No'  },
];

/**
 * A three-state (All / Yes / No) button-group toggle for boolean hotel filters.
 * Used consistently across Dashboard, Scan Results, Hotels, and similar pages.
 */
export function BoolFilterGroup({ label, value, onChange }: BoolFilterGroupProps) {
  return (
    <div>
      <label className="form-label fw-semibold mb-1 d-block small">{label}</label>
      <div className="btn-group btn-group-sm" role="group" aria-label={label}>
        {OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            className={`btn ${value === opt.value ? 'btn-secondary' : 'btn-outline-secondary'}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
