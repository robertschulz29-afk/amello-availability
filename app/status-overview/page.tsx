// app/status-overview/page.tsx
'use client';

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';

type Hotel = { id: number; name: string; code: string };

type SourceJob = {
  id: number;
  source: string;
  total_cells: number;
  done_cells: number;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
};

type ScanRow = {
  id: number;
  scanned_at: string;
  base_checkin: string | null;
  fixed_checkout: string | null;
  days: number | null;
  stay_nights: number;
  timezone: string | null;
  total_cells: number;
  done_cells: number;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  sources: string[] | null;
  source_jobs: SourceJob[];
};

function todayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

const STATUS_COLOR: Record<string, string> = {
  running: 'info', done: 'success', error: 'danger', cancelled: 'warning', queued: 'secondary',
};

function pct(done: number, total: number) {
  return total === 0 ? 0 : Math.floor((done / total) * 100);
}
function fmt(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

type ScanSource = { id: number; name: string; enabled: boolean };

export default function Page() {
  const [hotels, setHotels] = React.useState<Hotel[]>([]);
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [sources, setSources] = React.useState<ScanSource[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [cancelling, setCancelling] = React.useState(false);

  const defaultBase = addDays(todayYMD(), 5);
  const [baseCheckIn, setBaseCheckIn] = React.useState(defaultBase);
  const [days, setDays] = React.useState(86);
  const [stayNights, setStayNights] = React.useState(7);
  const [adultCount, setAdultCount] = React.useState(2);

  const loadScans = React.useCallback(async () => {
    try {
      const list = await fetchJSON('/api/scans', { cache: 'no-store' });
      setScans(Array.isArray(list) ? list : []);
    } catch { /* silent */ }
  }, []);

  const loadSources = React.useCallback(async () => {
    try {
      const list = await fetchJSON('/api/scan-sources', { cache: 'no-store' });
      setSources(Array.isArray(list) ? list : []);
    } catch { /* silent */ }
  }, []);

  async function toggleSource(source: ScanSource) {
    try {
      await fetchJSON('/api/scan-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: source.name, enabled: !source.enabled }),
      });
      await loadSources();
    } catch (e: any) {
      setError(e?.message || 'Failed to update source');
    }
  }

  React.useEffect(() => {
    fetchJSON('/api/hotels', { cache: 'no-store' })
      .then(d => setHotels(Array.isArray(d) ? d : []))
      .catch(() => {});
    loadScans();
    loadSources();
  }, [loadScans, loadSources]);

  // Poll while a scan is active
  const activeScans = scans.filter(s => s.status === 'running' || s.status === 'queued');
  React.useEffect(() => {
    if (activeScans.length === 0) return;
    const t = setInterval(loadScans, 3000);
    return () => clearInterval(t);
  }, [activeScans.length, loadScans]);

  async function startScan() {
    setBusy(true); setError(null); setSuccess(null);
    try {
      const res = await fetchJSON('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseCheckIn, days, stayNights, adultCount,
          sources: sources.filter(s => s.enabled === true).map(s => s.name),
        }),
      });
      const scanId = Number(res?.scanId);
      if (!Number.isFinite(scanId) || scanId <= 0) throw new Error('Invalid scanId from server');
      setSuccess(`Scan #${scanId} started.`);
      await loadScans();
    } catch (e: any) {
      setError(e?.message || 'Scan failed');
    } finally {
      setBusy(false);
    }
  }

  async function cancelScan(id: number) {
    setCancelling(true); setError(null);
    try {
      await fetchJSON(`/api/scans/${id}/stop`, { method: 'POST' });
      setSuccess(`Scan #${id} cancelled.`);
      await loadScans();
    } catch (e: any) {
      setError(e?.message || 'Failed to cancel');
    } finally {
      setCancelling(false);
    }
  }

  async function deleteScan(id: number) {
    if (!confirm(`Delete scan #${id} and all its results? This cannot be undone.`)) return;
    setDeletingId(id); setError(null);
    try {
      await fetchJSON(`/api/scans/${id}`, { method: 'DELETE' });
      setSuccess(`Scan #${id} deleted.`);
      await loadScans();
    } catch (e: any) {
      setError(e?.message || 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>

        {success && <div className="alert alert-success alert-dismissible" role="alert">{success}<button type="button" className="btn-close" onClick={() => setSuccess(null)} /></div>}
        {error && <div className="alert alert-danger alert-dismissible" role="alert">{error}<button type="button" className="btn-close" onClick={() => setError(null)} /></div>}

        {/* ── Create new scan ── */}
        <div className="card mb-4">
          <div className="card-header fw-semibold">Create New Scan</div>
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
              <label className="form-label">Days to scan</label>
              <input type="number" min={1} max={365} className="form-control" value={days} onChange={e => setDays(Number(e.target.value || 1))} />
            </div>
            <div className="col-sm-3">
              <label className="form-label">Adults</label>
              <input type="number" min={1} max={6} className="form-control" value={adultCount} onChange={e => setAdultCount(Number(e.target.value || 1))} />
            </div>
            {sources.length > 0 && (
              <div className="col-12">
                <label className="form-label">Sources</label>
                <div className="d-flex flex-wrap gap-3">
                  {sources.map(src => (
                    <div key={src.id} className="form-check form-switch mb-0">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        role="switch"
                        id={`src-${src.id}`}
                        checked={src.enabled === true}
                        onChange={() => toggleSource(src)}
                      />
                      <label className="form-check-label" htmlFor={`src-${src.id}`}>
                        <span className="fw-semibold text-capitalize">{src.name}</span>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="col-12">
              <button
                className="btn btn-success"
                onClick={startScan}
                disabled={busy || hotels.length === 0 || sources.every(s => s.enabled !== true)}
              >
                {busy ? 'Starting…' : 'Start Scan'}
              </button>
              {hotels.length === 0 && <span className="ms-3 text-muted small">No hotels loaded yet.</span>}
              {sources.length > 0 && sources.every(s => s.enabled !== true) && (
                <span className="ms-3 text-warning small">Enable at least one source to start a scan.</span>
              )}
            </div>
          </div>
        </div>

        {/* ── Scan list ── */}
        <div className="card">
          <div className="card-header fw-semibold">All Scans</div>
          <div className="table-responsive">
            <table className="table table-sm table-hover mb-0">
              <thead className="table-light">
                <tr>
                  <th>#</th>
                  <th>Created</th>
                  <th>Base check-in</th>
                  <th>Checkout</th>
                  <th>Days</th>
                  <th>Nights</th>
                  <th>Progress by source</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {scans.length === 0 && (
                  <tr><td colSpan={9} className="text-center text-muted py-3">No scans yet.</td></tr>
                )}
                {scans.map(s => {
                  const jobs: SourceJob[] = Array.isArray(s.source_jobs) ? s.source_jobs : [];
                  // Fall back to legacy sources list when no jobs exist (old scans)
                  const legacySources: string[] = jobs.length === 0
                    ? (s.sources ?? ['amello'])
                    : [];

                  return (
                    <tr key={s.id}>
                      <td className="align-middle">#{s.id}</td>
                      <td className="align-middle">{fmt(s.scanned_at)}</td>
                      <td className="align-middle">{s.base_checkin ?? '—'}</td>
                      <td className="align-middle">{s.fixed_checkout ?? '—'}</td>
                      <td className="align-middle">{s.days ?? '—'}</td>
                      <td className="align-middle">{s.stay_nights}</td>

                      {/* Per-source progress */}
                      <td className="align-middle" style={{ minWidth: 220 }}>
                        {jobs.length > 0 ? (
                          <div className="d-flex flex-column gap-1">
                            {jobs.map(j => (
                              <div key={j.id} className="d-flex align-items-center gap-2">
                                <span
                                  className={`badge text-bg-${STATUS_COLOR[j.status] ?? 'secondary'}`}
                                  style={{ fontSize: '0.65rem', minWidth: 56 }}
                                >
                                  {j.source}
                                </span>
                                <div className="progress flex-grow-1" style={{ height: 8 }}>
                                  <div
                                    className={`progress-bar bg-${STATUS_COLOR[j.status] ?? 'secondary'}`}
                                    style={{ width: `${pct(j.done_cells, j.total_cells)}%` }}
                                  />
                                </div>
                                <span className="small text-nowrap" style={{ minWidth: 60 }}>
                                  {j.done_cells}/{j.total_cells}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          /* Legacy scan: single combined bar */
                          <div className="d-flex flex-column gap-1">
                            {legacySources.map(src => (
                              <div key={src} className="d-flex align-items-center gap-2">
                                <span className="badge text-bg-secondary" style={{ fontSize: '0.65rem', minWidth: 56 }}>{src}</span>
                                <div className="progress flex-grow-1" style={{ height: 8 }}>
                                  <div className="progress-bar" style={{ width: `${pct(s.done_cells, s.total_cells)}%` }} />
                                </div>
                                <span className="small text-nowrap" style={{ minWidth: 60 }}>{s.done_cells}/{s.total_cells}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>

                      <td className="align-middle">
                        <span className={`badge bg-${STATUS_COLOR[s.status] ?? 'secondary'}`}>{s.status}</span>
                      </td>
                      <td className="align-middle text-nowrap">
                        <div className="d-flex gap-1">
                          <button
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => window.open(`/api/scans/${s.id}/export?format=long`, '_blank')}
                            title="Export CSV"
                          >
                            <i className="fas fa-download" />
                          </button>
                          {(s.status === 'running' || s.status === 'queued') && (
                            <button
                              className="btn btn-warning btn-sm"
                              onClick={() => cancelScan(s.id)}
                              disabled={cancelling}
                              title="Cancel scan"
                            >
                              <i className="fas fa-stop" />
                            </button>
                          )}
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => deleteScan(s.id)}
                            disabled={deletingId === s.id}
                            title="Delete scan"
                          >
                            {deletingId === s.id ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-trash" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
