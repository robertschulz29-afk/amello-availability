'use client';

import * as React from 'react';

type Hotel = { id: number; name: string; code: string };
type ScanRow = {
  id: number;
  scanned_at: string;
  start_offset: number;
  end_offset: number;
  stay_nights: number;
  total_cells: number;
  done_cells: number;
  status: 'queued' | 'running' | 'done' | 'error';
};
type ResultsMatrix = {
  scanId: number;
  scannedAt: string;
  dates: string[];
  results: Record<string, Record<string, 'green' | 'red'>>;
};

async function fetchJSON(input: RequestInfo, init?: RequestInit) {
  const r = await fetch(input, init);
  const text = await r.text();
  if (!r.ok) {
    try {
      const j = JSON.parse(text);
      throw new Error(j.error || r.statusText);
    } catch {
      throw new Error(text || r.statusText);
    }
  }
  return text ? JSON.parse(text) : null;
}

function fmtDateTime(dt: string) {
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt;
  }
}

export default function Page() {
  const [activeTab, setActiveTab] = React.useState<'hotels' | 'scan'>('hotels');

  // Hotels state
  const [hotels, setHotels] = React.useState<Hotel[]>([]);
  const [hName, setHName] = React.useState('');
  const [hCode, setHCode] = React.useState('');
  const [hError, setHError] = React.useState<string | null>(null);
  const [hBusy, setHBusy] = React.useState(false);

  // Scans state (list + selected)
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);

  // Progress + results for currently loaded scan (selected or just-run)
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{
    scanId?: number;
    total?: number;
    done?: number;
    status?: 'queued' | 'running' | 'done' | 'error';
  }>({});
  const [matrix, setMatrix] = React.useState<ResultsMatrix | null>(null);

  // Load hotels
  const loadHotels = React.useCallback(async () => {
    try {
      const data = await fetchJSON('/api/hotels', { cache: 'no-store' });
      setHotels(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setHError(e.message || 'Failed to load hotels');
    }
  }, []);

  // Load scans list
  const loadScans = React.useCallback(async () => {
    try {
      const list = await fetchJSON('/api/scans', { cache: 'no-store' });
      const arr: ScanRow[] = Array.isArray(list) ? list : [];
      arr.sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());
      setScans(arr);
      if (arr.length > 0 && selectedScanId == null) {
        setSelectedScanId(arr[0].id);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load scans');
    }
  }, [selectedScanId]);

  // Load matrix for a scan id
  const loadScanById = React.useCallback(async (scanId: number) => {
    setError(null);
    setMatrix(null);
    setProgress({});
    try {
      const data = await fetchJSON(`/api/scans/${scanId}`, { cache: 'no-store' });

      const s = scans.find((x) => x.id === scanId);
      if (s) {
        setProgress({
          scanId,
          total: s.total_cells,
          done: s.done_cells,
          status: s.status,
        });
      }

      const safeDates: string[] = Array.isArray(data?.dates) ? data.dates : [];
      const safeResults: Record<string, Record<string, 'green' | 'red'>> =
        data && typeof data.results === 'object' && data.results !== null ? data.results : {};

      setMatrix({
        scanId,
        scannedAt: String(data?.scannedAt ?? ''),
        dates: safeDates,
        results: safeResults,
      });
    } catch (e: any) {
      setError(e.message || 'Failed to load scan');
    }
  }, [scans]);

  // Initial loads
  React.useEffect(() => {
    loadHotels();
    loadScans();
  }, [loadHotels, loadScans]);

  // When selectedScanId changes, load that scan
  React.useEffect(() => {
    if (selectedScanId != null) {
      loadScanById(selectedScanId);
    }
  }, [selectedScanId, loadScanById]);

  // Add a hotel
  const onAddHotel = async (e: React.FormEvent) => {
    e.preventDefault();
    setHError(null);
    if (!hName.trim() || !hCode.trim()) {
      setHError('Name and Code are required');
      return;
    }
    setHBusy(true);
    try {
      const next = await fetchJSON('/api/hotels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: hName.trim(), code: hCode.trim() }),
      });
      setHotels(Array.isArray(next) ? next : hotels);
      setHName('');
      setHCode('');
    } catch (e: any) {
      setHError(e.message || 'Failed to add hotel');
    } finally {
      setHBusy(false);
    }
  };

  // Kickoff + process (new scan)
  const startScan = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    setMatrix(null);
    setProgress({});
    try {
      const kick = await fetchJSON('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const scanId = Number(kick?.scanId);
      const total = Number(kick?.totalCells ?? 0);
      if (!Number.isFinite(scanId) || scanId <= 0) throw new Error('Invalid scanId from server');
      setProgress({ scanId, total, done: 0, status: 'running' });

      // 2) Process in batches
      let idx = 0;
      const size = 50;
      while (true) {
        const r = await fetchJSON('/api/scans/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scanId, startIndex: idx, size }),
        });
        idx = Number(r?.nextIndex ?? idx);
        const processed = Number(r?.processed ?? 0);
        const doneFlag = Boolean(r?.done);
        setProgress((prev) => ({
          scanId,
          total,
          done: Math.min((prev.done ?? 0) + processed, total),
          status: doneFlag ? 'done' : 'running',
        }));
        if (doneFlag) break;
      }

      await loadScans();
      setSelectedScanId(scanId);
      setActiveTab('scan');
    } catch (e: any) {
      setError(e?.message || 'Scan failed');
      setProgress((p) => ({ ...p, status: 'error' }));
    } finally {
      setBusy(false);
    }
  }, [loadScans]);

  // Continue processing an existing running scan
  const continueProcessing = React.useCallback(async () => {
    if (!selectedScanId) return;
    const s = scans.find((x) => x.id === selectedScanId);
    if (!s) return;
    setBusy(true);
    setError(null);
    try {
      let idx = s.done_cells ?? 0;
      const total = s.total_cells ?? 0;
      const size = 50;
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
        setProgress((prev) => ({
          scanId: s.id,
          total,
          done: Math.min((prev.done ?? 0) + processed, total),
          status: doneFlag ? 'done' : 'running',
        }));
        if (doneFlag) break;
      }
      await loadScans();
      await loadScanById(s.id);
    } catch (e: any) {
      setError(e?.message || 'Continue failed');
    } finally {
      setBusy(false);
    }
  }, [selectedScanId, scans, loadScans, loadScanById]);

  // Derived for results table
  const dates = matrix?.dates ?? [];
  const hotelsByCode = React.useMemo(() => {
    const map = new Map<string, Hotel>();
    for (const h of hotels) map.set(h.code, h);
    return map;
  }, [hotels]);
  const hotelCodes = React.useMemo(() => {
    const codes = Object.keys(matrix?.results ?? {});
    return codes.length ? codes : hotels.map((h) => h.code);
  }, [matrix, hotels]);
  const cell = (code: string, date: string): 'green' | 'red' | undefined =>
    matrix?.results?.[code]?.[date];

  // NEW: per-date counters (greens, total(=greens+reds)), computed from matrix.results
  const columnCounters = React.useMemo(() => {
    const counters: { date: string; greens: number; total: number }[] = [];
    if (!matrix) return counters;
    for (const date of matrix.dates) {
      let greens = 0;
      let total = 0;
      for (const [hotelCode, row] of Object.entries(matrix.results ?? {})) {
        const v = row[date];
        if (v === 'green') {
          greens++;
          total++;
        } else if (v === 'red') {
          total++;
        } // undefined = no data -> excluded
      }
      counters.push({ date, greens, total });
    }
    return counters;
  }, [matrix]);

  // Scan navigation helpers
  const currentIndex = React.useMemo(
    () => (selectedScanId != null ? scans.findIndex((s) => s.id === selectedScanId) : -1),
    [scans, selectedScanId]
  );
  const onPrev = () => {
    if (currentIndex < 0) return;
    const nextIdx = currentIndex + 1;
    if (nextIdx < scans.length) setSelectedScanId(scans[nextIdx].id);
  };
  const onNext = () => {
    if (currentIndex <= 0) return;
    const nextIdx = currentIndex - 1;
    if (nextIdx >= 0) setSelectedScanId(scans[nextIdx].id);
  };
  const onLoadLatest = () => {
    if (scans.length > 0) setSelectedScanId(scans[0].id);
  };
  const onRefreshSelected = async () => {
    await loadScans();
    if (selectedScanId != null) await loadScanById(selectedScanId);
  };

  return (
    <main>
      <h1 className="mb-4">Amello Availability</h1>

      {/* Tabs header */}
      <ul className="nav nav-tabs">
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'hotels' ? 'active' : ''}`}
            onClick={() => setActiveTab('hotels')}
            type="button"
          >
            Hotels
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'scan' ? 'active' : ''}`}
            onClick={() => setActiveTab('scan')}
            type="button"
          >
            Scan Results
          </button>
        </li>
      </ul>

      <div className="tab-content pt-3">
        {/* Hotels tab */}
        <div className={`tab-pane fade ${activeTab === 'hotels' ? 'show active' : ''}`}>
          <div className="row g-3">
            <div className="col-lg-5">
              <div className="card">
                <div className="card-header">Add Hotel</div>
                <div className="card-body">
                  <form onSubmit={onAddHotel} className="row g-3">
                    <div className="col-12">
                      <label className="form-label">Name</label>
                      <input
                        className="form-control"
                        value={hName}
                        onChange={(e) => setHName(e.target.value)}
                        placeholder="Hotel Alpha"
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label">Code</label>
                      <input
                        className="form-control"
                        value={hCode}
                        onChange={(e) => setHCode(e.target.value)}
                        placeholder="ALPHA123"
                      />
                    </div>
                    {hError ? <div className="col-12 text-danger small">{hError}</div> : null}
                    <div className="col-12">
                      <button className="btn btn-primary" disabled={hBusy}>
                        {hBusy ? 'Saving…' : 'Add Hotel'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>

            <div className="col-lg-7">
              <div className="card">
                <div className="card-header">Current Hotels</div>
                <div className="card-body">
                  {hotels.length === 0 ? (
                    <p className="text-muted mb-0">No hotels yet. Add one on the left.</p>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-sm align-middle">
                        <thead>
                          <tr>
                            <th style={{ width: 60 }}>#</th>
                            <th>Name</th>
                            <th>Code</th>
                          </tr>
                        </thead>
                        <tbody>
                          {hotels.map((h, i) => (
                            <tr key={h.id}>
                              <td>{i + 1}</td>
                              <td>{h.name}</td>
                              <td><code>{h.code}</code></td>
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

        {/* Scan Results tab */}
        <div className={`tab-pane fade ${activeTab === 'scan' ? 'show active' : ''}`}>
          <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
            <button className="btn btn-success" onClick={startScan} disabled={busy || hotels.length === 0}>
              {busy ? 'Scanning…' : 'Start Scan'}
            </button>

            <div className="d-flex align-items-center gap-2">
              <select
                className="form-select"
                style={{ minWidth: 260 }}
                value={selectedScanId ?? ''}
                onChange={(e) => setSelectedScanId(Number(e.target.value))}
              >
                {scans.length === 0 ? (
                  <option value="">No scans</option>
                ) : (
                  scans.map((s) => (
                    <option key={s.id} value={s.id}>
                      #{s.id} • {fmtDateTime(s.scanned_at)} • {s.status} ({s.done_cells}/{s.total_cells})
                    </option>
                  ))
                )}
              </select>
              <button className="btn btn-outline-secondary" onClick={onLoadLatest} disabled={scans.length === 0}>
                Load latest
              </button>
              <button className="btn btn-outline-secondary" onClick={onPrev} disabled={currentIndex < 0 || currentIndex + 1 >= scans.length}>
                Prev
              </button>
              <button className="btn btn-outline-secondary" onClick={onNext} disabled={currentIndex <= 0}>
                Next
              </button>
              <button className="btn btn-outline-secondary" onClick={onRefreshSelected} disabled={selectedScanId == null}>
                Refresh
              </button>
              {progress.status === 'running' ? (
                <button className="btn btn-outline-primary" onClick={continueProcessing} disabled={busy}>
                  Continue processing
                </button>
              ) : null}
            </div>
          </div>

          {progress?.scanId ? (
            <div className="mb-3">
              <div className="d-flex justify-content-between small">
                <div>
                  Scan <strong>#{progress.scanId}</strong> — {progress.status}
                </div>
                <div>
                  {progress.done ?? 0}/{progress.total ?? 0}
                </div>
              </div>
              <div className="progress" role="progressbar" aria-label="scan progress" aria-valuemin={0} aria-valuemax={progress.total ?? 0} aria-valuenow={progress.done ?? 0}>
                <div
                  className="progress-bar"
                  style={{
                    width:
                      progress.total && progress.total > 0
                        ? `${Math.floor(((progress.done ?? 0) / progress.total) * 100)}%`
                        : '0%',
                  }}
                />
              </div>
            </div>
          ) : null}

          {error ? <div className="alert alert-danger">{error}</div> : null}

          {/* Results table */}
          {dates.length > 0 && hotelCodes.length > 0 ? (
            <div className="table-responsive border rounded">
              <table className="table table-sm mb-0">
                <thead className="table-light sticky-top">
                  <tr>
                    <th style={{ position: 'sticky', left: 0, background: 'var(--bs-table-bg)', zIndex: 3 }}>
                      Hotel (Name • Code)
                    </th>

                    {/* NEW: Counter row (greens/total) above the date header cell */}
                    {dates.map((d) => {
                      const counter = columnCounters.find((c) => c.date === d);
                      const greens = counter?.greens ?? 0;
                      const total = counter?.total ?? 0;
                      const pct = total > 0 ? Math.round((greens / total) * 100) : 0;
                      return (
                        <th key={'counter-' + d} className="text-center" style={{ verticalAlign: 'bottom', whiteSpace: 'nowrap' }}>
                          <div className="small text-muted" style={{ lineHeight: '1' }}>
                            <div>{greens} / {total}</div>
                            <div>{total > 0 ? `${pct}%` : ''}</div>
                          </div>
                        </th>
                      );
                    })}
                  </tr>

                  {/* Actual date header row */}
                  <tr>
                    <th style={{ position: 'sticky', left: 0, background: 'var(--bs-table-bg)', zIndex: 2 }}>
                      {/* spacer for hotel column */}
                    </th>
                    {dates.map((d) => (
                      <th key={d} className="text-nowrap">{d}</th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {hotelCodes.map((code) => {
                    const h = hotelsByCode.get(code);
                    const label = h ? `${h.name} • ${h.code}` : code;
                    return (
                      <tr key={code}>
                        <td style={{ position: 'sticky', left: 0, background: 'var(--bs-body-bg)', zIndex: 1 }}>
                          {label}
                        </td>
                        {dates.map((d) => {
                          const s = cell(code, d);
                          const cls =
                            s === 'green' ? 'table-success' :
                            s === 'red'   ? 'table-danger'  : '';
                          return (
                            <td key={code + d} className={`${cls} text-center small`}>
                              {s ?? ''}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted">No results yet for this scan.</p>
          )}
        </div>
      </div>
    </main>
  );
}
