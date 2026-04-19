'use client';

import * as React from 'react';

type Hotel = { id: number; name: string; code: string; brand?: string };

type Props = {
  hotels: Hotel[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
  style?: React.CSSProperties;
};

function label(selectedIds: number[], hotels: Hotel[], placeholder: string): string {
  if (selectedIds.length === 0) return placeholder;
  if (selectedIds.length === hotels.length) return 'All Hotels';
  if (selectedIds.length === 1) {
    const h = hotels.find(h => h.id === selectedIds[0]);
    return h ? `${h.name} (${h.code})` : '1 hotel';
  }
  return `${selectedIds.length} hotels selected`;
}

export function HotelCombobox({ hotels, selectedIds, onChange, placeholder = 'All Hotels', size, style }: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Group hotels by brand
  const groups = React.useMemo(() => {
    const map = new Map<string, Hotel[]>();
    for (const h of hotels) {
      const brand = h.brand?.trim() || '(no brand)';
      const arr = map.get(brand) ?? [];
      arr.push(h);
      map.set(brand, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [hotels]);

  const filteredGroups = React.useMemo(() => {
    if (!query.trim()) return groups;
    const t = query.toLowerCase();
    return groups
      .map(([brand, hs]) => [brand, hs.filter(h =>
        h.name.toLowerCase().includes(t) || h.code.toLowerCase().includes(t)
      )] as [string, Hotel[]])
      .filter(([, hs]) => hs.length > 0);
  }, [groups, query]);

  const selectedSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);

  function toggle(id: number) {
    if (selectedSet.has(id)) onChange(selectedIds.filter(x => x !== id));
    else onChange([...selectedIds, id]);
  }

  function toggleBrand(brandHotels: Hotel[]) {
    const ids = brandHotels.map(h => h.id);
    const allSelected = ids.every(id => selectedSet.has(id));
    if (allSelected) onChange(selectedIds.filter(id => !ids.includes(id)));
    else onChange([...new Set([...selectedIds, ...ids])]);
  }

  function selectAll() { onChange(hotels.map(h => h.id)); }
  function deselectAll() { onChange([]); }

  React.useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false); setQuery('');
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const btnClass = size === 'sm'
    ? 'btn btn-outline-secondary btn-sm w-100 text-start'
    : 'btn btn-outline-secondary w-100 text-start';

  const displayLabel = label(selectedIds, hotels, placeholder);

  return (
    <div ref={containerRef} style={{ position: 'relative', ...style }}>
      <button
        type="button"
        className={btnClass}
        onClick={() => { setOpen(o => !o); setQuery(''); }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayLabel}
        </span>
        <span style={{ opacity: 0.5, fontSize: '0.75rem', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', zIndex: 1050, top: '100%', left: 0,
            minWidth: '100%', width: 320,
            border: '1px solid var(--bs-border-color)', borderRadius: '0.375rem',
            background: 'var(--bs-body-bg)', boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            display: 'flex', flexDirection: 'column', maxHeight: 380,
          }}
        >
          {/* Search */}
          <div style={{ padding: '8px 8px 4px' }}>
            <input
              autoFocus
              className={size === 'sm' ? 'form-control form-control-sm' : 'form-control'}
              placeholder="Search hotels…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && (setOpen(false), setQuery(''))}
            />
          </div>

          {/* Select all / deselect all */}
          <div style={{ display: 'flex', gap: 4, padding: '4px 8px', borderBottom: '1px solid var(--bs-border-color)' }}>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary flex-fill"
              onPointerDown={e => { e.preventDefault(); selectAll(); }}
            >Select all</button>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary flex-fill"
              onPointerDown={e => { e.preventDefault(); deselectAll(); }}
            >Deselect all</button>
          </div>

          {/* Groups */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filteredGroups.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: '0.875rem', opacity: 0.5 }}>No hotels found</div>
            )}
            {filteredGroups.map(([brand, brandHotels]) => {
              const allSel = brandHotels.every(h => selectedSet.has(h.id));
              const someSel = !allSel && brandHotels.some(h => selectedSet.has(h.id));
              return (
                <div key={brand}>
                  {/* Brand row */}
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', cursor: 'pointer',
                      borderBottom: '1px solid var(--bs-border-color)',
                      background: 'var(--bs-secondary-bg)',
                    }}
                    onPointerDown={e => { e.preventDefault(); toggleBrand(brandHotels); }}
                  >
                    <input
                      type="checkbox"
                      className="form-check-input mt-0"
                      checked={allSel}
                      ref={el => { if (el) el.indeterminate = someSel; }}
                      onChange={() => {}}
                      style={{ cursor: 'pointer', flexShrink: 0 }}
                    />
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, flex: 1 }}>{brand}</span>
                    <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>{brandHotels.length}</span>
                  </div>
                  {/* Hotel rows */}
                  {brandHotels.map(h => (
                    <div
                      key={h.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '5px 10px 5px 26px', cursor: 'pointer',
                        background: selectedSet.has(h.id) ? 'var(--bs-primary-bg-subtle)' : undefined,
                      }}
                      onPointerDown={e => { e.preventDefault(); toggle(h.id); }}
                      onMouseEnter={e => { if (!selectedSet.has(h.id)) e.currentTarget.style.background = 'var(--bs-secondary-bg)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = selectedSet.has(h.id) ? 'var(--bs-primary-bg-subtle)' : ''; }}
                    >
                      <input
                        type="checkbox"
                        className="form-check-input mt-0"
                        checked={selectedSet.has(h.id)}
                        onChange={() => {}}
                        style={{ cursor: 'pointer', flexShrink: 0 }}
                      />
                      <span style={{ fontSize: '0.875rem', flex: 1 }}>{h.name}</span>
                      <span style={{ fontSize: '0.75rem', opacity: 0.4 }}>{h.code}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          {selectedIds.length > 0 && (
            <div style={{ padding: '6px 10px', borderTop: '1px solid var(--bs-border-color)', fontSize: '0.8rem', opacity: 0.6 }}>
              {selectedIds.length} of {hotels.length} selected
            </div>
          )}
        </div>
      )}
    </div>
  );
}
