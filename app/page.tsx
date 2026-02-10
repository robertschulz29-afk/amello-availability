// app/page.tsx (Dashboard - Results only)
'use client';

import * as React from 'react';

type Hotel = { id: number; name: string; code: string; brand?: string; region?: string; country?: string };
type ScanRow = {
  id: number; scanned_at: string;
  stay_nights: number; total_cells: number; done_cells: number;
  status: 'queued'|'running'|'done'|'error';
};
type ResultsMatrix = {
  scanId: number;
  scannedAt: string;
  baseCheckIn: string | null;
  fixedCheckout: string | null;
  days: number | null;
  stayNights: number | null;
  timezone: string | null;
  dates: string[];
  results: Record<string, Record<string, 'green' | 'red'>>;
};

async function fetchJSON(input: RequestInfo, init?: RequestInit) {
  const r = await fetch(input, init);
  const text = await r.text();
  if (!r.ok) {
    try { const j = JSON.parse(text); throw new Error(j.error || r.statusText); }
    catch { throw new Error(text || r.statusText); }
  }
  return text ? JSON.parse(text) : null;
}

function fmtDateTime(dt: string) {
  try { return new Date(dt).toLocaleString(); } catch { return dt; }
}

/** --- Availability Overview Tile --- */
/**
 * Displays the overall availability score for a scan.
 * Score represents the percentage of green (available) results across all hotels and dates.
 * Calculation: (count of green cells / total cells with results) * 100
 */
function AvailabilityOverviewTile({ matrix }: { matrix: ResultsMatrix | null }) {
  const score = React.useMemo(() => {
    if (!matrix || !matrix.results) return null;
    
    let availableCells = 0;  // Count of green (available) results
    let totalCells = 0;      // Total cells with scan results
    
    // Count all green results across all hotels and dates
    // Only 'green' and 'red' are valid result types in the system
    for (const hotelResults of Object.values(matrix.results)) {
      for (const result of Object.values(hotelResults)) {
        if (result === 'green') availableCells++;
        if (result === 'green' || result === 'red') totalCells++;
      }
    }
    
    if (totalCells === 0) return null;
    return (availableCells / totalCells) * 100;
  }, [matrix]);
  
  if (score === null) return null;
  
  // Determine color based on score
  let bgColor = '#ffc107'; // amber/yellow (60-80%)
  let textColor = '#000';
  
  if (score > 80) {
    bgColor = '#28a745'; // green
    textColor = '#fff';
  } else if (score < 60) {
    bgColor = '#dc3545'; // red
    textColor = '#fff';
  }
  
  return (
    <div className="card mb-3" style={{ backgroundColor: bgColor, color: textColor }}>
      <div className="card-body text-center">
        <h5 className="card-title mb-2" style={{ color: textColor }}>Availability overview</h5>
        <h2 className="mb-0" style={{ fontSize: '2.5rem', fontWeight: 'bold', color: textColor }}>
          {score.toFixed(1)}%
        </h2>
      </div>
    </div>
  );
}

/** --- Small SVG bar chart (no external deps) --- */
function GroupBarChart({
  title,
  series,       // [{ date, pct, greens, total }]
  height = 180, // px
  barWidth = 14,
  gap = 6,
}: {
  title: string;
  series: Array<{ date: string; pct: number; greens: number; total: number }>;
  height?: number;
  barWidth?: number;
  gap?: number;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(300);

  React.useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };
    updateWidth();
    
    // Debounce resize events for better performance
    let timeoutId: NodeJS.Timeout;
    const debouncedUpdate = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(updateWidth, 100);
    };
    
    window.addEventListener('resize', debouncedUpdate);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', debouncedUpdate);
    };
  }, []);

  const innerPadTop = 16;
  const innerPadBottom = 36;
  const maxBarArea = height - innerPadTop - innerPadBottom;

  // Calculate width to fill container, but respect minimum based on series length
  const minWidthForSeries = series.length * (barWidth + gap) + 40;
  const width = Math.max(containerWidth, minWidthForSeries);
  const xStart = 20;

  const yFor = (pct: number) => {
    const clamped = Math.max(0, Math.min(100, pct));
    return innerPadTop + (100 - clamped) / 100 * maxBarArea;
  };

  const labelEvery = series.length > 120 ? 10
                     : series.length > 80 ? 6
                     : series.length > 50 ? 4
                     : series.length > 25 ? 2
                     : 1;

  return (
    <div className="card mb-3">
      <div className="card-header d-flex justify-content-between align-items-center">
        <span>{title}</span>
        <span className="small text-muted">Green % by day</span>
      </div>
      <div className="card-body" style={{ overflowX: 'auto' }} ref={containerRef}>
        <svg width={width} height={height} role="img" aria-label={`${title} green percentage chart`}>
          {[25,50,75].map((p) => (
            <g key={`grid-${p}`}>
              <line x1={0} y1={yFor(p)} x2={width} y2={yFor(p)} stroke="currentColor" strokeOpacity="0.1" />
              <text x={4} y={yFor(p) - 2} fontSize="10" fill="currentColor" fillOpacity="0.6">{p}%</text>
            </g>
          ))}
          {series.map((pt, idx) => {
            const x = xStart + idx * (barWidth + gap);
            const y = yFor(pt.pct);
            const h = (innerPadTop + maxBarArea) - y;
            return (
              <g key={pt.date}>
                <title>{`${pt.date}: ${isFinite(pt.pct) ? Math.round(pt.pct) : 0}% (${pt.greens}/${pt.total})`}</title>
                <rect x={x} y={y} width={barWidth} height={isFinite(h) ? h : 0} fill="currentColor" fillOpacity="0.25" />
                {idx % labelEvery === 0 && (
                  <text x={x + barWidth/2} y={height - 8} textAnchor="end" fontSize="10" fill="currentColor" fillOpacity="0.7" transform={`rotate(-45 ${x + barWidth/2} ${height - 8})`}>
                    {pt.date}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export default function Page() {
  // Hotels
  const [hotels, setHotels] = React.useState<Hotel[]>([]);

  // Scans
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);

  // Progress/results
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [matrix, setMatrix] = React.useState<ResultsMatrix | null>(null);

  // Grouping
  type GroupBy = 'none'|'brand'|'region'|'country';
  const [groupBy, setGroupBy] = React.useState<GroupBy>('none');

  // Load hotels
  const loadHotels = React.useCallback(async () => {
    try {
      const data = await fetchJSON('/api/hotels', { cache: 'no-store' });
      setHotels(Array.isArray(data) ? data : []);
    } catch (e:any) {
      // Silently fail for dashboard
    }
  }, []);

  // Load scans list
  const loadScans = React.useCallback(async () => {
    try {
      const list = await fetchJSON('/api/scans', { cache: 'no-store' });
      const arr: ScanRow[] = Array.isArray(list) ? list : [];
      arr.sort((a,b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());
      setScans(arr);
      if (arr.length > 0 && selectedScanId == null) setSelectedScanId(arr[0].id);
    } catch (e:any) {
      setError(e.message || 'Failed to load scans');
    }
  }, [selectedScanId]);

  // Load one scan by id
  const loadScanById = React.useCallback(async (scanId: number) => {
    setLoading(true);
    setError(null); setMatrix(null);
    try {
      const data = await fetchJSON(`/api/scans/${scanId}`, { cache: 'no-store' });
      const safeDates: string[] = Array.isArray(data?.dates) ? data.dates : [];
      const safeResults: Record<string, Record<string, 'green'|'red'>> =
        data && typeof data.results === 'object' && data.results !== null ? data.results : {};
      setMatrix({
        scanId,
        scannedAt: String(data?.scannedAt ?? ''),
        baseCheckIn: data?.baseCheckIn ?? null,
        fixedCheckout: data?.fixedCheckout ?? null,
        days: data?.days ?? null,
        stayNights: data?.stayNights ?? null,
        timezone: data?.timezone ?? null,
        dates: safeDates,
        results: safeResults
      });
    } catch (e:any) {
      setError(e.message || 'Failed to load scan');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { loadHotels(); loadScans(); }, [loadHotels, loadScans]);
  React.useEffect(() => { if (selectedScanId != null) loadScanById(selectedScanId); }, [selectedScanId, loadScanById]);

  // Derived
  const dates = matrix?.dates ?? [];
  const hotelsByCode = React.useMemo(() => {
    const map = new Map<string, Hotel>(); for (const h of hotels) map.set(h.code, h); return map;
  }, [hotels]);

  // Grouping
  type Group = { label: string; codes: string[] };
  const groups = React.useMemo(() => {
    const gmap = new Map<string, string[]>(); // groupLabel -> hotelCodes[]
    const byCode = hotelsByCode;
    const allCodes = Object.keys(matrix?.results ?? {});
    const universe = allCodes.length ? allCodes : hotels.map(h => h.code);

    function keyFor(h: Hotel): string {
      if (groupBy === 'brand')   return (h.brand   && h.brand.trim())   || '(no brand)';
      if (groupBy === 'region')  return (h.region  && h.region.trim())  || '(no region)';
      if (groupBy === 'country') return (h.country && h.country.trim()) || '(no country)';
      return 'All Hotels';
    }

    for (const code of universe) {
      const h = byCode.get(code);
      const label = h ? keyFor(h) : 'All Hotels';
      const arr = gmap.get(label) || [];
      arr.push(code);
      gmap.set(label, arr);
    }

    const out = Array.from(gmap.entries()).map(([label, codes]) => {
      codes.sort((a,b) => {
        const ha = byCode.get(a), hb = byCode.get(b);
        const na = ha?.name || a, nb = hb?.name || b;
        return na.localeCompare(nb);
      });
      return { label, codes };
    });
    out.sort((a,b) => a.label.localeCompare(b.label));
    return out;
  }, [groupBy, hotels, hotelsByCode, matrix]);

  // Scan navigation
  const currentIndex = React.useMemo(
    () => (selectedScanId != null ? scans.findIndex(s => s.id === selectedScanId) : -1),
    [scans, selectedScanId]
  );
  const onPrev = () => { if (currentIndex < 0) return; const nextIdx = currentIndex + 1; if (nextIdx < scans.length) setSelectedScanId(scans[nextIdx].id); };
  const onNext = () => { if (currentIndex <= 0) return; const nextIdx = currentIndex - 1; if (nextIdx >= 0) setSelectedScanId(scans[nextIdx].id); };

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>
      
      {/* Scan Selection */}
      <div className="mb-3">
        <select className="form-select" style={{ minWidth: 250, maxWidth: '100%' }} value={selectedScanId ?? ''} onChange={e => setSelectedScanId(Number(e.target.value))}>
          {scans.length === 0 ? <option value="">No scans</option> : scans.map(s => (
            <option key={s.id} value={s.id}>
              #{s.id} • {fmtDateTime(s.scanned_at)} • {s.status} ({s.done_cells}/{s.total_cells})
            </option>
          ))}
        </select>
      </div>

      {/* Scan Parameters */}
      {matrix ? (
        <div className="card mb-3">
          <div className="card-header">Scan Parameters</div>
          <div className="card-body small">
            <div className="row g-2">
              <div className="col-sm-6 col-md-3"><strong>Scan Date:</strong> {fmtDateTime(matrix.scannedAt)}</div>
              <div className="col-sm-6 col-md-3"><strong>Check-in Date:</strong> {matrix.baseCheckIn ?? '—'}</div>
              <div className="col-sm-6 col-md-3"><strong>Days Scanned:</strong> {matrix.days ?? '—'}</div>
              <div className="col-sm-6 col-md-3"><strong>Stay (nights):</strong> {matrix.stayNights ?? '—'}</div>
            </div>
          </div>
        </div>
      ) : null}
      
      {/* Availability Overview Tile */}
      <AvailabilityOverviewTile matrix={matrix} />

      {/* History navigation + grouping controls */}
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        <div className="d-flex flex-wrap align-items-center gap-2">
          <button className="btn btn-outline-secondary" onClick={() => scans.length && setSelectedScanId(scans[0].id)} disabled={scans.length === 0}>Newest</button>
          <button className="btn btn-outline-secondary" onClick={onPrev} disabled={!scans.length}>Prev</button>
          <button className="btn btn-outline-secondary" onClick={onNext} disabled={!scans.length}>Next</button>
          <button className="btn btn-outline-secondary" onClick={async()=>{ await loadScans(); if (selectedScanId!=null) await loadScanById(selectedScanId); }} disabled={selectedScanId==null}>Refresh</button>
        </div>

        <div className="ms-auto d-flex align-items-center gap-2">
          <label className="form-label mb-0">Group by:</label>
          <select className="form-select" value={groupBy} onChange={e => setGroupBy(e.target.value as any)}>
            <option value="none">None</option>
            <option value="brand">Brand</option>
            <option value="region">Region</option>
            <option value="country">Country</option>
          </select>
        </div>
      </div>

      {error ? <div className="alert alert-danger">{error}</div> : null}

      {/* Loading spinner */}
      {loading ? (
        <div className="text-center my-5">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <div className="mt-2 text-muted">Loading scan data...</div>
        </div>
      ) : null}

      {/* Grouped chart per group (no tables) */}
      {!loading && dates.length > 0 && groups.length > 0 ? (
        <>
          {groups.map(g => {
            const series = (matrix?.dates ?? []).map(d => {
              let greens = 0, total = 0;
              for (const code of g.codes) {
                const v = matrix?.results?.[code]?.[d];
                if (v === 'green') { greens++; total++; }
                else if (v === 'red') { total++; }
              }
              const pct = total > 0 ? (greens / total) * 100 : 0;
              return { date: d, pct, greens, total };
            });

            return (
              <div key={g.label} className="mb-4">
                <GroupBarChart
                  title={g.label}
                  series={series}
                  height={180}
                  barWidth={12}
                  gap={5}
                />
              </div>
            );
          })}
        </>
      ) : (
        <p className="text-muted">No results.</p>
      )}
      </div>
    </main>
  );
}
