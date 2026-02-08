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
  const innerPadTop = 16;
  const innerPadBottom = 36;
  const maxBarArea = height - innerPadTop - innerPadBottom;

  const width = Math.max(300, series.length * (barWidth + gap) + 40);
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
      <div className="card-body" style={{ overflowX: 'auto' }}>
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
                {h >= 18 && (
                  <text x={x + barWidth/2} y={y - 4} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.7">
                    {isFinite(pt.pct) ? Math.round(pt.pct) : 0}%
                  </text>
                )}
                {idx % labelEvery === 0 && (
                  <text x={x + barWidth/2} y={height - 8} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.7">
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
      

      {/* History + grouping controls */}
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        <div className="d-flex align-items-center gap-2">
          <select className="form-select" style={{ minWidth: 300 }} value={selectedScanId ?? ''} onChange={e => setSelectedScanId(Number(e.target.value))}>
            {scans.length === 0 ? <option value="">No scans</option> : scans.map(s => (
              <option key={s.id} value={s.id}>
                #{s.id} • {fmtDateTime(s.scanned_at)} • {s.status} ({s.done_cells}/{s.total_cells})
              </option>
            ))}
          </select>
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

      {/* Scan details */}
      {matrix ? (
        <div className="card mb-3">
          <div className="card-header">Scan details</div>
          <div className="card-body small">
            <div className="row g-2">
              <div className="col-sm-6 col-md-4"><strong>Scan ID:</strong> {matrix.scanId}</div>
              <div className="col-sm-6 col-md-4"><strong>Scanned at:</strong> {fmtDateTime(matrix.scannedAt)}</div>
              <div className="col-sm-6 col-md-4"><strong>Timezone:</strong> {matrix.timezone ?? '—'}</div>
              <div className="col-sm-6 col-md-4"><strong>Base check-in:</strong> {matrix.baseCheckIn ?? '—'}</div>
              <div className="col-sm-6 col-md-4"><strong>Fixed checkout (first column):</strong> {matrix.fixedCheckout ?? '—'}</div>
              <div className="col-sm-6 col-md-4"><strong>Days scanned (columns):</strong> {matrix.days ?? '—'}</div>
              <div className="col-sm-6 col-md-4"><strong>Stay (nights):</strong> {matrix.stayNights ?? '—'}</div>
              <div className="col-sm-6 col-md-4"><strong>Unique dates returned:</strong> {matrix.dates.length}</div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Grouped chart per group (no tables) */}
      {dates.length > 0 && groups.length > 0 ? (
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
    </main>
  );
}
