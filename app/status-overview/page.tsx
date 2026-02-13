// app/status-overview/page.tsx
'use client';

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';

type Hotel = { id: number; name: string; code: string; brand?: string; region?: string; country?: string };
type ScanRow = {
  id: number; scanned_at: string;
  stay_nights: number; total_cells: number; done_cells: number;
  status: 'queued'|'running'|'done'|'error'|'cancelled';
};
type CurrentScan = {
  id: number;
  status: 'queued'|'running'|'done'|'error'|'cancelled';
  total_cells: number;
  done_cells: number;
  scanned_at: string;
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

function getStatusColor(status: string): string {
  switch (status) {
    case 'running': return 'info';
    case 'done': return 'success';
    case 'error': return 'danger';
    case 'cancelled': return 'warning';
    case 'queued': return 'secondary';
    default: return 'secondary';
  }
}

function getPercentage(scan: { done_cells: number; total_cells: number }): number {
  if (scan.total_cells === 0) return 0;
  return Math.floor((scan.done_cells / scan.total_cells) * 100);
}

function formatDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      return isoString;
    }
    return date.toLocaleString();
  } catch {
    return isoString;
  }
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

  // Current scan status
  const [currentScan, setCurrentScan] = React.useState<CurrentScan | null>(null);
  const [cancelling, setCancelling] = React.useState(false);

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

  // Load current scan status
  const loadCurrentScan = React.useCallback(async () => {
    try {
      const list = await fetchJSON('/api/scans', { cache: 'no-store' });
      const arr: ScanRow[] = Array.isArray(list) ? list : [];
      if (arr.length === 0) {
        setCurrentScan(null);
        return;
      }
      // Sort by scanned_at to get the most recent scan
      arr.sort((a,b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());
      const latest = arr[0];
      setCurrentScan({
        id: latest.id,
        status: latest.status,
        total_cells: latest.total_cells,
        done_cells: latest.done_cells,
        scanned_at: latest.scanned_at,
      });
    } catch (e:any) {
      // Silently fail
    }
  }, []);

  React.useEffect(() => { loadHotels(); loadScans(); loadCurrentScan(); }, [loadHotels, loadScans, loadCurrentScan]);

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
      
      // Reload scans list and current scan
      await loadScans();
      await loadCurrentScan();
      setSelectedScanId(scanId);
    } catch (e:any) {
      setError(e?.message || 'Scan failed');
    } finally { 
      setBusy(false); 
    }
  }, [baseCheckIn, days, stayNights, adultCount, loadScans, loadCurrentScan]);

  // Cancel scan
  const cancelScan = React.useCallback(async (scanId: number) => {
    setCancelling(true);
    setError(null);
    try {
      await fetchJSON(`/api/scans/${scanId}/stop`, {
        method: 'POST'
      });
      // Reload scan status
      await loadCurrentScan();
      setSuccessMessage(`Scan #${scanId} cancelled successfully.`);
    } catch (e:any) {
      setError(e?.message || 'Failed to cancel scan');
    } finally {
      setCancelling(false);
    }
  }, [loadCurrentScan]);

  // Polling logic for active scans
  React.useEffect(() => {
    if (!currentScan || (currentScan.status !== 'running' && currentScan.status !== 'queued')) {
      return; // Don't poll if no active scan
    }
    
    const interval = setInterval(async () => {
      await loadCurrentScan();
    }, 3000); // Poll every 3 seconds
    
    return () => clearInterval(interval);
  }, [currentScan, loadCurrentScan]);

  return (
    <main>
      <h1 className="mb-4">Scan Setup</h1>

      {/* Current Scan Status Card */}
      {currentScan && (
        <div className={`card mb-3 border-${getStatusColor(currentScan.status)}`}>
          <div className="card-header">
            Current Scan Status
          </div>
          <div className="card-body">
            <div className="row mb-2">
              <div className="col-sm-4"><strong>Scan ID:</strong> #{currentScan.id}</div>
              <div className="col-sm-4"><strong>Status:</strong> {currentScan.status}</div>
              <div className="col-sm-4"><strong>Started:</strong> {formatDateTime(currentScan.scanned_at)}</div>
            </div>
            
            {/* Progress Bar */}
            <div className="mb-2">
              <div className="d-flex justify-content-between small mb-1">
                <span>Progress</span>
                <span>{currentScan.done_cells} / {currentScan.total_cells} cells ({getPercentage(currentScan)}%)</span>
              </div>
              <div className="progress">
                <div 
                  className="progress-bar" 
                  style={{ width: `${getPercentage(currentScan)}%` }}
                />
              </div>
            </div>
            
            {/* Cancel Button */}
            {(currentScan.status === 'running' || currentScan.status === 'queued') && (
              <button 
                className="btn btn-danger btn-sm" 
                onClick={() => cancelScan(currentScan.id)}
                disabled={cancelling}
              >
                {cancelling ? 'Cancelling...' : 'Stop Scan'}
              </button>
            )}
          </div>
        </div>
      )}

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
