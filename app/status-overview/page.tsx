// app/status-overview/page.tsx
'use client';

import * as React from 'react';
import { extractLowestPrice, formatPrice } from '@/lib/price-utils';

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
  prices?: Record<string, Record<string, number | null>>; // hotelCode -> date -> price
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
function todayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}
function addDays(ymd: string, n: number): string {
  const [y,m,d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth()+1).padStart(2,'0');
  const dd2 = String(dt.getUTCDate()).padStart(2,'0');
  return `${yy}-${mm}-${dd2}`;
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
  const innerPadBottom = 55;
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
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{ scanId?:number; total?:number; done?:number; status?:'queued'|'running'|'done'|'error'; }>({});
  const [matrix, setMatrix] = React.useState<ResultsMatrix | null>(null);

  // Scan parameter controls (defaults: base = today+5, days=86, stay=7)
  const defaultBase = addDays(todayYMD(), 5);
  const [baseCheckIn, setBaseCheckIn] = React.useState<string>(defaultBase);
  const [days, setDays] = React.useState<number>(86);
  const [stayNights, setStayNights] = React.useState<number>(7);
  const [adultCount, setAdultCount] = React.useState<number>(2); // configurable adults

  // Grouping
  type GroupBy = 'none'|'brand'|'region'|'country';
  const [groupBy, setGroupBy] = React.useState<GroupBy>('none');

  // Load hotels
  const loadHotels = React.useCallback(async () => {
    try {
      const data = await fetchJSON('/api/hotels', { cache: 'no-store' });
      setHotels(Array.isArray(data) ? data : []);
    } catch (e:any) {
      // Silently fail for scan results page
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
    setError(null); setMatrix(null); setProgress({});
    try {
      const data = await fetchJSON(`/api/scans/${scanId}`, { cache: 'no-store' });
      const s = scans.find(x => x.id === scanId);
      if (s) setProgress({ scanId, total: s.total_cells, done: s.done_cells, status: s.status });
      const safeDates: string[] = Array.isArray(data?.dates) ? data.dates : [];
      const safeResults: Record<string, Record<string, 'green'|'red'>> =
        data && typeof data.results === 'object' && data.results !== null ? data.results : {};
      const safePrices: Record<string, Record<string, number | null>> =
        data && typeof data.prices === 'object' && data.prices !== null ? data.prices : {};
      setMatrix({
        scanId,
        scannedAt: String(data?.scannedAt ?? ''),
        baseCheckIn: data?.baseCheckIn ?? null,
        fixedCheckout: data?.fixedCheckout ?? null,
        days: data?.days ?? null,
        stayNights: data?.stayNights ?? null,
        timezone: data?.timezone ?? null,
        dates: safeDates,
        results: safeResults,
        prices: safePrices,
      });
    } catch (e:any) {
      setError(e.message || 'Failed to load scan');
    } finally {
      setLoading(false);
    }
  }, [scans]);

  React.useEffect(() => { loadHotels(); loadScans(); }, [loadHotels, loadScans]);
  React.useEffect(() => { if (selectedScanId != null) loadScanById(selectedScanId); }, [selectedScanId, loadScanById]);

  // Start new scan
  const startScan = React.useCallback(async () => {
    setBusy(true); setError(null); setMatrix(null); setProgress({});
    try {
      const kick = await fetchJSON('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseCheckIn,
          days,
          stayNights,
          adultCount, // optional: persist if backend supports it
        }),
      });
      const scanId = Number(kick?.scanId);
      const total = Number(kick?.totalCells ?? 0);
      if (!Number.isFinite(scanId) || scanId <= 0) throw new Error('Invalid scanId from server');
      setProgress({ scanId, total, done: 0, status: 'running' });

      // Process in batches
      let idx = 0; const size = 30;
      while (true) {
        const r = await fetchJSON('/api/scans/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scanId, startIndex: idx, size }),
        });
        idx = Number(r?.nextIndex ?? idx);
        const processed = Number(r?.processed ?? 0);
        const doneFlag = Boolean(r?.done);
        setProgress(prev => ({ scanId, total, done: Math.min((prev.done ?? 0) + processed, total), status: doneFlag ? 'done' : 'running' }));
        if (doneFlag) break;
      }

      await loadScans();
      setSelectedScanId(scanId);
    } catch (e:any) {
      setError(e?.message || 'Scan failed');
      setProgress(p => ({ ...p, status: 'error' }));
    } finally { setBusy(false); }
  }, [baseCheckIn, days, stayNights, adultCount, loadScans]);

  // Continue processing existing scan
  const continueProcessing = React.useCallback(async () => {
    if (!selectedScanId) return;
    const s = scans.find(x => x.id === selectedScanId); if (!s) return;
    setBusy(true); setError(null);
    try {
      let idx = s.done_cells ?? 0; const total = s.total_cells ?? 0; const size = 30;
      setProgress({ scanId: s.id, total, done: idx, status: 'running' });
      while (true) {
        const r = await fetchJSON('/api/scans/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scanId: s.id, startIndex: idx, size }),
        });
        idx = Number(r?.nextIndex ?? idx);
        const processed = Number(r?.processed ?? 0);
        const doneFlag = Boolean(r?.done);
        setProgress(prev => ({ scanId: s.id, total, done: Math.min((prev.done ?? 0) + processed, total), status: doneFlag ? 'done' : 'running' }));
        if (doneFlag) break;
      }
      await loadScans();
      await loadScanById(s.id);
    } catch (e:any) {
      setError(e?.message || 'Continue failed');
    } finally { setBusy(false); }
  }, [selectedScanId, scans, loadScans, loadScanById]);

  // Derived
  const dates = matrix?.dates ?? [];
  const hotelsByCode = React.useMemo(() => {
    const map = new Map<string, Hotel>(); for (const h of hotels) map.set(h.code, h); return map;
  }, [hotels]);
  const cell = (code: string, date: string): 'green'|'red'|undefined => matrix?.results?.[code]?.[date];

  // Column counters
  const columnCounters = React.useMemo(() => {
    const counters: { date: string; greens: number; total: number }[] = [];
    if (!matrix) return counters;
    for (const date of matrix.dates) {
      let greens = 0, total = 0;
      for (const row of Object.values(matrix.results ?? {})) {
        const v = row[date]; if (v === 'green') { greens++; total++; } else if (v === 'red') { total++; }
      }
      counters.push({ date, greens, total });
    }
    return counters;
  }, [matrix]);

  // Grouping
  type Group = { label: string; codes: string[] };
  const groups = React.useMemo(() => {
    const gmap = new Map<string, string[]>(); // groupLabel -> hotelCodes[]
    const byCode = hotelsByCode;
    const allCodes = Object.keys(matrix?.results ?? {});
    const universe = allCodes.length ? allCodes : hotels.map(h => h.code);

    function keyFor(h: Hotel): string {
      if (groupBy === 'brand')   return h.brand?.trim()   || '(no brand)';
      if (groupBy === 'region')  return h.region?.trim()  || '(no region)';
      if (groupBy === 'country') return h.country?.trim() || '(no country)';
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

      {/* Scan parameter controls */}
      <div className="card mb-3">
        <div className="card-header">Scan Parameters</div>
        <div className="card-body row g-3">
              <div className="col-sm-3">
                <label className="form-label">Check-in date</label>
                <input type="date" className="form-control" value={baseCheckIn} onChange={e => setBaseCheckIn(e.target.value)} />
              </div>
              <div className="col-sm-3">
                <label className="form-label">Stay (nights)</label>
                <input type="number" min={1} max={30} className="form-control" value={stayNights} onChange={e => setStayNights(Number(e.target.value || 1))} />
              </div>
              <div className="col-sm-3">
                <label className="form-label">Days to scan (columns)</label>
                <input type="number" min={1} max={365} className="form-control" value={days} onChange={e => setDays(Number(e.target.value || 1))} />
              </div>
              <div className="col-sm-3">
                <label className="form-label">Adults</label>
                <input type="number" min={1} max={6} className="form-control" value={adultCount} onChange={e => setAdultCount(Number(e.target.value || 1))} />
              </div>
              <div className="col-12 d-flex gap-2">
                <button className="btn btn-success" onClick={startScan} disabled={busy || hotels.length === 0}>
                  {busy ? 'Scanning…' : 'Start scan'}
                </button>
                <button
                  className="btn btn-outline-success"
                  onClick={() => {
                    if (!selectedScanId) return;
                    window.open(`/api/scans/${selectedScanId}/export?format=long`, '_blank');
                  }}
                  disabled={selectedScanId == null}
                >
                  Export CSV
                </button>
              </div>
            </div>
          </div>

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
              {progress.status === 'running' ? (
                <button className="btn btn-outline-primary" onClick={continueProcessing} disabled={busy}>Continue</button>
              ) : null}
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

          {/* Progress */}
          {progress?.scanId ? (
            <div className="mb-3">
              <div className="d-flex justify-content-between small">
                <div>Scan <strong>#{progress.scanId}</strong> — {progress.status}</div>
                <div>{progress.done ?? 0}/{progress.total ?? 0}</div>
              </div>
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total ?? 0} aria-valuenow={progress.done ?? 0}>
                <div className="progress-bar" style={{ width: (progress.total && progress.total>0) ? `${Math.floor(((progress.done ?? 0)/(progress.total))*100)}%` : '0%' }} />
              </div>
            </div>
          ) : null}

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

          {/* Global column counters header */}
          {!loading && dates.length > 0 && (
            <div className="table-responsive border rounded mb-3">
              <table className="table table-sm mb-0">
                <thead className="table-light sticky-top">
                  <tr>
                    <th style={{ position:'sticky', left:0, background:'var(--bs-table-bg)', zIndex:3 }}>Hotel (Name • Code)</th>
                    {dates.map(d => {
                      const c = columnCounters.find(x => x.date === d);
                      const greens = c?.greens ?? 0, total = c?.total ?? 0;
                      const pct = total > 0 ? Math.round((greens/total)*100) : 0;
                      return (
                        <th key={'c-'+d} className="text-center" style={{ whiteSpace:'nowrap' }}>
                          <div className="small text-muted" style={{ lineHeight:1 }}>
                            <div>{greens} / {total}</div>
                            <div>{total>0 ? `${pct}%` : ''}</div>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                  <tr>
                    <th style={{ position:'sticky', left:0, background:'var(--bs-table-bg)', zIndex:2 }} />
                    {dates.map(d => <th key={d} className="text-nowrap">{d}</th>)}
                  </tr>
                </thead>
              </table>
            </div>
          )}

          {/* Grouped chart + table per group */}
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

                    <div className="table-responsive border rounded">
                      <table className="table table-sm mb-0">
                        <thead className="table-light">
                          <tr>
                            <th style={{ position:'sticky', left:0, background:'var(--bs-table-bg)', zIndex:1 }}>Hotel (Name • Code)</th>
                            {dates.map(d => <th key={g.label + d} className="text-nowrap">{d}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {g.codes.map(code => {
                            const h = hotelsByCode.get(code);
                            const label = h ? `${h.name} • ${h.code}` : code;
                            return (
                              <tr key={code}>
                                <td style={{ position:'sticky', left:0, background:'var(--bs-body-bg)', zIndex:1 }}>{label}</td>
                                {dates.map(d => {
                                  const v = matrix?.results?.[code]?.[d];
                                  const price = matrix?.prices?.[code]?.[d];
                                  const cls = v === 'green' ? 'table-success' : v === 'red' ? 'table-danger' : '';
                                  // For green cells, show the price or "—" if unavailable; for red cells, show 'red'; for empty cells, show nothing
                                  let content = '';
                                  if (v === 'green') {
                                    content = price != null ? formatPrice(price, null) : '—';
                                  } else if (v === 'red') {
                                    content = 'red';
                                  }
                                  return <td key={code + d} className={`${cls} text-center small`}>{content}</td>;
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
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
