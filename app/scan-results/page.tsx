// app/scan-results/page.tsx
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

export default function Page() {
  // Hotels
  const [hotels, setHotels] = React.useState<Hotel[]>([]);

  // Scans
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);

  // Progress/results
  const [error, setError] = React.useState<string | null>(null);
  const [matrix, setMatrix] = React.useState<ResultsMatrix | null>(null);

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

  // Scan navigation
  const currentIndex = React.useMemo(
    () => (selectedScanId != null ? scans.findIndex(s => s.id === selectedScanId) : -1),
    [scans, selectedScanId]
  );
  const onPrev = () => { if (currentIndex < 0) return; const nextIdx = currentIndex + 1; if (nextIdx < scans.length) setSelectedScanId(scans[nextIdx].id); };
  const onNext = () => { if (currentIndex <= 0) return; const nextIdx = currentIndex - 1; if (nextIdx >= 0) setSelectedScanId(scans[nextIdx].id); };

  return (
    <main style={{ maxWidth: '90%' }}>

      {/* Scan selector */}
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

      {/* Results table */}
      {dates.length > 0 ? (
        <div className="table-responsive border rounded">
          <table className="table table-sm mb-0">
            <thead className="table-light">
              <tr>
                <th style={{ position:'sticky', left:0, background:'var(--bs-table-bg)', zIndex:1 }}>Hotel (Name • Code)</th>
                {dates.map(d => <th key={d} className="text-nowrap">{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {Object.keys(matrix?.results ?? {}).sort((a, b) => {
                const ha = hotelsByCode.get(a), hb = hotelsByCode.get(b);
                const na = ha?.name || a, nb = hb?.name || b;
                return na.localeCompare(nb);
              }).map(code => {
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
      ) : (
        <p className="text-muted">No results.</p>
      )}
    </main>
  );
}
