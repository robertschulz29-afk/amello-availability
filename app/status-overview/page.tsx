// app/status-overview/page.tsx
'use client';

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';

type Hotel = { id: number; name: string; code: string; brand?: string; region?: string; country?: string };
type ScanRow = {
  id: number; scanned_at: string;
  stay_nights: number; total_cells: number; done_cells: number;
  status: 'queued'|'running'|'done'|'error';
};

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

export default function Page() {
  // Hotels
  const [hotels, setHotels] = React.useState<Hotel[]>([]);

  // Scans (for export functionality)
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);

  // State for scan operations
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);

  // Scan parameter controls (defaults: base = today+5, days=86, stay=7)
  const defaultBase = addDays(todayYMD(), 5);
  const [baseCheckIn, setBaseCheckIn] = React.useState<string>(defaultBase);
  const [days, setDays] = React.useState<number>(86);
  const [stayNights, setStayNights] = React.useState<number>(7);
  const [adultCount, setAdultCount] = React.useState<number>(2);

  // Load hotels
  const loadHotels = React.useCallback(async () => {
    try {
      const data = await fetchJSON('/api/hotels', { cache: 'no-store' });
      setHotels(Array.isArray(data) ? data : []);
    } catch (e:any) {
      // Silently fail
    }
  }, []);

  // Load scans list (for export functionality)
  const loadScans = React.useCallback(async () => {
    try {
      const list = await fetchJSON('/api/scans', { cache: 'no-store' });
      const arr: ScanRow[] = Array.isArray(list) ? list : [];
      arr.sort((a,b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());
      setScans(arr);
      if (arr.length > 0 && selectedScanId == null) setSelectedScanId(arr[0].id);
    } catch (e:any) {
      // Silently fail
    }
  }, [selectedScanId]);

  React.useEffect(() => { loadHotels(); loadScans(); }, [loadHotels, loadScans]);

  // Start new scan - simplified to just create scan without processing loop
  const startScan = React.useCallback(async () => {
    setBusy(true); 
    setError(null); 
    setSuccessMessage(null);
    try {
      const kick = await fetchJSON('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseCheckIn,
          days,
          stayNights,
          adultCount,
        }),
      });
      const scanId = Number(kick?.scanId);
      if (!Number.isFinite(scanId) || scanId <= 0) throw new Error('Invalid scanId from server');
      
      // Show success message
      setSuccessMessage(`Scan #${scanId} started! Visit Availability Overview or Scan Results to see progress.`);
      
      // Reload scans list
      await loadScans();
      setSelectedScanId(scanId);
    } catch (e:any) {
      setError(e?.message || 'Scan failed');
    } finally { 
      setBusy(false); 
    }
  }, [baseCheckIn, days, stayNights, adultCount, loadScans]);

  return (
    <main>
      <h1 className="mb-4">Scan Setup</h1>

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

          {/* Success message */}
          {successMessage ? <div className="alert alert-success">{successMessage}</div> : null}

          {/* Error message */}
          {error ? <div className="alert alert-danger">{error}</div> : null}
    </main>
  );
}
