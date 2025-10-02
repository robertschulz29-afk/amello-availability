// app/page.tsx
'use client';

import * as React from 'react';

type Hotel = { id: number; name: string; code: string };
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

export default function Page() {
  const [activeTab, setActiveTab] = React.useState<'hotels' | 'scan'>('hotels');

  // Hotels state
  const [hotels, setHotels] = React.useState<Hotel[]>([]);
  const [hName, setHName] = React.useState('');
  const [hCode, setHCode] = React.useState('');
  const [hError, setHError] = React.useState<string | null>(null);
  const [hBusy, setHBusy] = React.useState(false);

  // Scan/progress/results state
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{
    scanId?: number;
    total?: number;
    done?: number;
    status?: 'queued' | 'running' | 'done' | 'error';
  }>({});
  const [matrix, setMatrix] = React.useState<ResultsMatrix | null>(null);

  // Load hotels on mount (and when switching to Hotels tab)
  const loadHotels = React.useCallback(async () => {
    try {
      const data = await fetchJSON('/api/hotels', { cache: 'no-store' });
      setHotels(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setHError(e.message || 'Failed to load hotels');
    }
  }, []);

  React.useEffect(() => {
    loadHotels();
  }, [loadHotels]);

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
      // API accepts single object or array; we’ll send single
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

  // Kickoff + batched processing + load matrix
  const startScan = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    setMatrix(null);
    setProgress({});

    try {
      // 1) Kickoff
      const kick = await fetchJSON('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Optionally override defaults:
        // body: JSON.stringify({ startOffset: 5, endOffset: 90, stayNights: 7 }),
      });
      const scanId = Number(kick?.scanId);
      const total = Number(kick?.totalCells ?? 0);
      if (!Number.isFinite(scanId) || scanId <= 0) throw new Error('Invalid scanId from server');
      setProgress({ scanId, total, done: 0, status: 'running' });

      // 2) Process in batches
      let idx = 0;
      const size = 50; // tune 25..100
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
        // Optional throttle:
        // await new Promise(res => setTimeout(res, 150));
      }

      // 3) Load matrix
      const data = await fetchJSON(`/api/scans/${scanId}`, { cache: 'no-store' });
      const safeDates: string[] = Array.isArray(data?.dates) ? data.dates : [];
      const safeResults: Record<string, Record<string, 'green' | 'red'>> =
        data && typeof data.results === 'object' && data.results !== null ? data.results : {};

      setMatrix({
        scanId,
        scannedAt: String(data?.scannedAt ?? ''),
        dates: safeDates,
        results: safeResults,
      });
      // Switch to Scan tab automatically to show results
      setActiveTab('scan');
    } catch (e: any) {
      setError(e?.message || 'Scan failed');
      setProgress((p) => ({ ...p, status: 'error' }));
    } finally {
      setBusy(false);
    }
  }, []);

  // Derived for results table
  const dates = matrix?.dates ?? [];
  const hotelsByCode = React.useMemo(() => {
    const map = new Map<string, Hotel>();
    for (const h of hotels) map.set(h.code, h);
    return map;
  }, [hotels]);
  const hotelCodes = React.useMemo(() => {
    const codes = Object.keys(matrix?.results ?? {});
    // Ensure we include hotels with no data yet if needed
    return codes.length ? codes : hotels.map((h) => h.code);
  }, [matrix, hotels]);
  const cell = (code: string, date: string): 'green' | 'red' | undefined =>
    matrix?.results?.[code]?.[date];

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

      {/* Tabs content */}
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
          <div className="d-flex align-items-center gap-2 mb-3">
            <button className="btn btn-success" onClick={startScan} disabled={busy || hotels.length === 0}>
              {busy ? 'Scanning…' : 'Start Scan'}
            </button>
            <div className="small text-muted">
              {hotels.length === 0 ? 'Add at least one hotel to enable scanning.' : null}
            </div>
          </div>

          {progress?.scanId ? (
            <div className="mb-3">
              <div className="d-flex justify-content-between">
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
                <thead className="table-light">
                  <tr>
                    <th style={{ position: 'sticky', left: 0, background: 'var(--bs-table-bg)', zIndex: 1 }}>
                      Hotel (Name • Code)
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
                          // Bootstrap contextual backgrounds
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
            <p className="text-muted">No results yet. Start a scan to populate the table.</p>
          )}
        </div>
      </div>
    </main>
  );
}
