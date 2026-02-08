// app/page.tsx (DROP-IN)
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
  const [activeTab, setActiveTab] = React.useState<'dashboard' | 'scan' | 'hotels'>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  // Hotels
  const [hotels, setHotels] = React.useState<Hotel[]>([]);
  const [hName, setHName] = React.useState('');
  const [hCode, setHCode] = React.useState('');
  const [hBrand, setHBrand] = React.useState('');
  const [hRegion, setHRegion] = React.useState('');
  const [hCountry, setHCountry] = React.useState('');
  const [hError, setHError] = React.useState<string | null>(null);
  const [hBusy, setHBusy] = React.useState(false);

  // Scans
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);

  // Progress/results
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
      setHError(e.message || 'Failed to load hotels');
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
    setError(null); setMatrix(null); setProgress({});
    try {
      const data = await fetchJSON(`/api/scans/${scanId}`, { cache: 'no-store' });
      const s = scans.find(x => x.id === scanId);
      if (s) setProgress({ scanId, total: s.total_cells, done: s.done_cells, status: s.status });
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
  }, [scans]);

  React.useEffect(() => { loadHotels(); loadScans(); }, [loadHotels, loadScans]);
  React.useEffect(() => { if (selectedScanId != null) loadScanById(selectedScanId); }, [selectedScanId, loadScanById]);

  // Add hotel
  const onAddHotel = async (e: React.FormEvent) => {
    e.preventDefault();
    setHError(null);
    if (!hName.trim() || !hCode.trim()) { setHError('Name and Code are required'); return; }
    setHBusy(true);
    try {
      const next = await fetchJSON('/api/hotels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: hName.trim(),
          code: hCode.trim(),
          brand: hBrand.trim() || null,
          region: hRegion.trim() || null,
          country: hCountry.trim() || null
        }),
      });
      setHotels(Array.isArray(next) ? next : hotels);
      setHName(''); setHCode(''); setHBrand(''); setHRegion(''); setHCountry('');
    } catch (e:any) {
      setHError(e.message || 'Saving failed');
    } finally { setHBusy(false); }
  };

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
      setActiveTab('scan');
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
    <div className="d-flex" style={{ minHeight: '100vh', margin: 0, padding: 0 }}>
      {/* Sidebar */}
      <div 
        className="bg-dark text-white d-flex flex-column"
        style={{ 
          width: sidebarCollapsed ? '60px' : '250px',
          transition: 'width 0.3s ease',
          position: 'relative'
        }}
      >
        <div className="p-3 border-bottom border-secondary d-flex justify-content-between align-items-center">
          {!sidebarCollapsed && <h5 className="mb-0">Menu</h5>}
          <button 
            className="btn btn-sm btn-outline-light"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <i className="fas fa-bars"></i> : <i className="fas fa-times"></i>}
          </button>
        </div>
        
        <nav className="flex-grow-1">
          <ul className="nav flex-column">
            <li className="nav-item">
              <button
                className={`nav-link text-white w-100 text-start ${activeTab === 'dashboard' ? 'bg-primary' : ''}`}
                onClick={() => setActiveTab('dashboard')}
                title="Dashboard"
              >
                <i className="fas fa-chart-bar me-2"></i>
                {!sidebarCollapsed && 'Dashboard'}
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link text-white w-100 text-start ${activeTab === 'scan' ? 'bg-primary' : ''}`}
                onClick={() => setActiveTab('scan')}
                title="Scan Results"
              >
                <i className="fas fa-chart-line me-2"></i>
                {!sidebarCollapsed && 'Scan Results'}
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link text-white w-100 text-start ${activeTab === 'hotels' ? 'bg-primary' : ''}`}
                onClick={() => setActiveTab('hotels')}
                title="Hotels"
              >
                <i className="fas fa-hotel me-2"></i>
                {!sidebarCollapsed && 'Hotels'}
              </button>
            </li>
          </ul>
        </nav>
      </div>

      {/* Main content */}
      <div className="flex-grow-1 p-4" style={{ overflowX: 'auto' }}>
        <h1 className="mb-4">Amello Availability</h1>

        {/* Dashboard tab */}
        {activeTab === 'dashboard' && (
          <div>
            <h2>Dashboard</h2>
            <p className="text-muted">Dashboard content coming soon...</p>
          </div>
        )}

        {/* Hotels tab */}
        {activeTab === 'hotels' && (
          <div>
          <div className="row g-3">
            <div className="col-lg-5">
              <div className="card">
                <div className="card-header">Add Hotel</div>
                <div className="card-body">
                  <form onSubmit={onAddHotel} className="row g-3">
                    <div className="col-12">
                      <label className="form-label">Name</label>
                      <input className="form-control" value={hName} onChange={e => setHName(e.target.value)} placeholder="Hotel Alpha" />
                    </div>
                    <div className="col-12">
                      <label className="form-label">Code</label>
                      <input className="form-control" value={hCode} onChange={e => setHCode(e.target.value)} placeholder="ALPHA123" />
                    </div>
                    <div className="col-12">
                      <label className="form-label">Brand</label>
                      <input className="form-control" value={hBrand} onChange={e => setHBrand(e.target.value)} placeholder="e.g., Amello" />
                    </div>
                    <div className="col-12">
                      <label className="form-label">Region</label>
                      <input className="form-control" value={hRegion} onChange={e => setHRegion(e.target.value)} placeholder="e.g., Algarve" />
                    </div>
                    <div className="col-12">
                      <label className="form-label">Country</label>
                      <input className="form-control" value={hCountry} onChange={e => setHCountry(e.target.value)} placeholder="e.g., Portugal" />
                    </div>

                    {hError ? <div className="col-12 text-danger small">{hError}</div> : null}
                    <div className="col-12">
                      <button className="btn btn-primary" disabled={hBusy}>{hBusy ? 'Saving…' : 'Add hotel'}</button>
                    </div>
                  </form>
                </div>
              </div>
            </div>

            <div className="col-lg-7">
              <div className="card">
                <div className="card-header">Current Hotels</div>
                <div className="card-body">
                  {hotels.length === 0 ? <p className="text-muted mb-0">No hotels yet.</p> : (
                    <div className="table-responsive">
                      <table className="table table-sm align-middle">
                        <thead>
                          <tr>
                            <th style={{ width: 60 }}>#</th>
                            <th>Name</th>
                            <th>Code</th>
                            <th>Brand</th>
                            <th>Region</th>
                            <th>Country</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hotels.map((h,i) => (
                            <tr key={h.id}>
                              <td>{i+1}</td>
                              <td>{h.name}</td>
                              <td><code>{h.code}</code></td>
                              <td>{h.brand || ''}</td>
                              <td>{h.region || ''}</td>
                              <td>{h.country || ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          </div>
        )}

        {/* Scan Results tab */}
        {activeTab === 'scan' && (
          <div>
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
          {dates.length > 0 && (
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
                                  const cls = v === 'green' ? 'table-success' : v === 'red' ? 'table-danger' : '';
                                  return <td key={code + d} className={`${cls} text-center small`}>{v ?? ''}</td>;
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
        </div>
        )}
      </div>
    </div>
  );
}
