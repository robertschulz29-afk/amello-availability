'use client';

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';
import { OCCUPANCY_CONFIGS } from '@/lib/playwright-scan-helpers';

// ── Types ─────────────────────────────────────────────────────────────────────

type PlaywrightScan = {
  id: number;
  check_in: string;
  take_screenshot: boolean;
  status: string;
  total: number;
  processed: number;
  errors: number;
  created_at: string;
  finished_at: string | null;
};

type CrRoom = {
  hotel_id: number;
  name: string;
  room_code: string | null;
  global_types: string[] | null;
  image_url: string | null;
};

type PlaywrightOccResult = {
  hotel_id: number;
  occupancy: string;
  rooms: Array<{ roomName: string; imageMissing: boolean }> | null;
  screenshot_url: string | null;
  error: string | null;
};

type HotelEntry = {
  hotel: { id: number; name: string; code: string; brand: string | null };
  crRooms: CrRoom[];
  playwrightScanId: number | null;
  playwrightResults: Record<string, PlaywrightOccResult> | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function tomorrow(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RoomsCrApiPage() {
  // Scan history
  const [scans, setScans] = React.useState<PlaywrightScan[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);

  // Hotel data
  const [entries, setEntries] = React.useState<HotelEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = React.useState(false);
  const [entriesError, setEntriesError] = React.useState<string | null>(null);

  // Active scan polling
  const [activeScanId, setActiveScanId] = React.useState<number | null>(null);
  const [activeScanStatus, setActiveScanStatus] = React.useState<PlaywrightScan | null>(null);

  // Trigger form
  const [checkIn, setCheckIn] = React.useState(tomorrow());
  const [takeScreenshot, setTakeScreenshot] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [startError, setStartError] = React.useState<string | null>(null);

  // Expanded accordion state: hotelId → set of occupancy labels
  const [expandedOcc, setExpandedOcc] = React.useState<Map<number, Set<string>>>(new Map());

  // ── Load scan history ──────────────────────────────────────────────────────

  const loadScans = React.useCallback(async () => {
    try {
      const list = await fetchJSON('/api/playwright-scan/scans', { cache: 'no-store' });
      if (Array.isArray(list)) setScans(list);
    } catch {
      // non-fatal
    }
  }, []);

  React.useEffect(() => {
    loadScans();
  }, [loadScans]);

  // Auto-select most recent done scan on first load
  React.useEffect(() => {
    if (scans.length > 0 && selectedScanId === null) {
      const done = scans.find(s => s.status === 'done');
      if (done) setSelectedScanId(done.id);
    }
  }, [scans, selectedScanId]);

  // ── Load hotel data ────────────────────────────────────────────────────────

  const loadEntries = React.useCallback(
    async (scanId: number | null) => {
      setLoadingEntries(true);
      setEntriesError(null);
      try {
        const url =
          scanId !== null
            ? `/api/rooms-cr-api?playwrightScanId=${scanId}`
            : '/api/rooms-cr-api';
        const data = await fetchJSON(url, { cache: 'no-store' });
        setEntries(Array.isArray(data) ? data : []);
      } catch (e: any) {
        setEntriesError(e.message || 'Failed to load data');
      } finally {
        setLoadingEntries(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    loadEntries(selectedScanId);
  }, [selectedScanId, loadEntries]);

  // ── Polling for active scan ────────────────────────────────────────────────

  React.useEffect(() => {
    if (activeScanId === null) return;

    const interval = setInterval(async () => {
      try {
        const data: PlaywrightScan = await fetchJSON(
          `/api/playwright-scan?scanId=${activeScanId}`,
          { cache: 'no-store' },
        );
        setActiveScanStatus(data);
        if (data.status === 'done' || data.status === 'cancelled') {
          clearInterval(interval);
          setActiveScanId(null);
          // Reload scan list and results
          await loadScans();
          setSelectedScanId(data.id);
        }
      } catch {
        // ignore transient errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [activeScanId, loadScans]);

  // ── Start scan ────────────────────────────────────────────────────────────

  async function startScan() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch('/api/playwright-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkIn, takeScreenshot }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Error ${res.status}`);
      }
      const { scanId, total } = json as { scanId: number; total: number };
      setActiveScanId(scanId);
      setActiveScanStatus({
        id: scanId,
        check_in: checkIn,
        take_screenshot: takeScreenshot,
        status: 'running',
        total,
        processed: 0,
        errors: 0,
        created_at: new Date().toISOString(),
        finished_at: null,
      });
      await loadScans();
    } catch (e: any) {
      setStartError(e.message || 'Failed to start scan');
    } finally {
      setStarting(false);
    }
  }

  // ── Toggle occupancy accordion ─────────────────────────────────────────────

  function toggleOcc(hotelId: number, label: string) {
    setExpandedOcc(prev => {
      const next = new Map(prev);
      const set = new Set(next.get(hotelId) ?? []);
      if (set.has(label)) {
        set.delete(label);
      } else {
        set.add(label);
      }
      next.set(hotelId, set);
      return next;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const isScanning = activeScanId !== null;
  const scanPct =
    activeScanStatus && activeScanStatus.total > 0
      ? Math.round(
          ((activeScanStatus.processed + activeScanStatus.errors) / activeScanStatus.total) * 100,
        )
      : 0;

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>
        <h4 className="mb-3">Rooms / CR-API</h4>

        {/* ── Scan trigger card ── */}
        <div className="card mb-4">
          <div className="card-header fw-semibold">Playwright Scan</div>
          <div className="card-body">
            {startError && (
              <div className="alert alert-danger alert-dismissible py-2" role="alert">
                {startError}
                <button type="button" className="btn-close" onClick={() => setStartError(null)} />
              </div>
            )}

            {!isScanning && (
              <div className="row g-3 align-items-end">
                <div className="col-sm-auto">
                  <label className="form-label fw-semibold">Check-In Date</label>
                  <input
                    type="date"
                    className="form-control form-control-sm"
                    value={checkIn}
                    onChange={e => setCheckIn(e.target.value)}
                  />
                </div>
                <div className="col-sm-auto d-flex align-items-end pb-1">
                  <div className="form-check">
                    <input
                      type="checkbox"
                      id="takeScreenshot"
                      className="form-check-input"
                      checked={takeScreenshot}
                      onChange={e => setTakeScreenshot(e.target.checked)}
                    />
                    <label className="form-check-label" htmlFor="takeScreenshot">
                      Take Screenshots
                    </label>
                  </div>
                </div>
                <div className="col-sm-auto">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={startScan}
                    disabled={starting || !checkIn}
                  >
                    {starting ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-1" />
                        Starting…
                      </>
                    ) : (
                      'Start Scan'
                    )}
                  </button>
                </div>
              </div>
            )}

            {isScanning && activeScanStatus && (
              <div>
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <span className="small fw-semibold">
                    Scanning… {activeScanStatus.processed + activeScanStatus.errors} /{' '}
                    {activeScanStatus.total} processed
                    {activeScanStatus.errors > 0 && (
                      <span className="text-danger ms-2">({activeScanStatus.errors} errors)</span>
                    )}
                  </span>
                  <span className="small text-muted">{scanPct}%</span>
                </div>
                <div className="progress" style={{ height: 8 }}>
                  <div
                    className="progress-bar progress-bar-striped progress-bar-animated"
                    role="progressbar"
                    style={{ width: `${scanPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Scan history select ── */}
        <div className="card mb-4">
          <div className="card-body row g-3 align-items-end">
            <div className="col-sm-5">
              <label className="form-label fw-semibold">Playwright Scan History</label>
              <select
                className="form-select form-select-sm"
                value={selectedScanId ?? ''}
                onChange={e => setSelectedScanId(Number(e.target.value) || null)}
              >
                <option value="">— select a scan —</option>
                {scans.map(s => (
                  <option key={s.id} value={s.id}>
                    #{s.id} — {s.check_in} — {s.status} ({s.processed}/{s.total})
                    {s.finished_at ? ` — finished ${fmt(s.finished_at)}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ── Loading ── */}
        {loadingEntries && (
          <div className="text-center py-5">
            <div className="spinner-border text-secondary" role="status">
              <span className="visually-hidden">Loading…</span>
            </div>
          </div>
        )}

        {entriesError && (
          <div className="alert alert-danger" role="alert">
            {entriesError}
          </div>
        )}

        {/* ── Hotel cards ── */}
        {!loadingEntries &&
          entries.map(entry => (
            <div key={entry.hotel.id} className="card mb-4">
              {/* Header */}
              <div className="card-header fw-semibold d-flex align-items-center gap-3">
                <span>
                  {entry.hotel.name}
                  <span className="ms-2 text-muted fw-normal small">{entry.hotel.code}</span>
                </span>
                <span className="ms-auto">
                  <span
                    className="badge bg-primary fw-normal"
                    title="CR-API room count"
                  >
                    CR-API: {entry.crRooms.length} rooms
                  </span>
                </span>
              </div>

              <div className="card-body">
                <div className="row g-3">
                  {/* ── Left: CR-API rooms ── */}
                  <div className="col-12 col-md-6">
                    <div className="fw-semibold small mb-2">CR-API Rooms</div>
                    {entry.crRooms.length === 0 ? (
                      <p className="text-muted small mb-0">No CR-API rooms synced</p>
                    ) : (
                      <div className="d-flex flex-column gap-2">
                        {entry.crRooms.map((room, idx) => (
                          <div key={idx} className="d-flex gap-2 align-items-start">
                            {room.image_url && (
                              <img
                                src={room.image_url}
                                alt={room.name}
                                style={{
                                  width: 56,
                                  height: 40,
                                  objectFit: 'cover',
                                  borderRadius: 4,
                                  flexShrink: 0,
                                }}
                              />
                            )}
                            <div>
                              <div className="small fw-semibold">{room.name}</div>
                              {room.room_code && (
                                <div className="small text-muted">{room.room_code}</div>
                              )}
                              {room.global_types && room.global_types.length > 0 && (
                                <div className="d-flex flex-wrap gap-1 mt-1">
                                  {room.global_types.map(gt => (
                                    <span key={gt} className="badge bg-secondary fw-normal small">
                                      {gt}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ── Right: Playwright results ── */}
                  <div className="col-12 col-md-6">
                    <div className="fw-semibold small mb-2">Playwright Results</div>
                    {entry.playwrightResults === null ? (
                      <p className="text-muted small mb-0">
                        No scan data — run a scan above
                      </p>
                    ) : (
                      <div className="accordion accordion-flush" id={`acc-${entry.hotel.id}`}>
                        {OCCUPANCY_CONFIGS.map(occ => {
                          const result = entry.playwrightResults?.[occ.folder] ?? null;
                          const isOpen =
                            expandedOcc.get(entry.hotel.id)?.has(occ.label) ?? false;
                          return (
                            <div key={occ.label} className="accordion-item">
                              <h2 className="accordion-header">
                                <button
                                  className={`accordion-button py-2 small${isOpen ? '' : ' collapsed'}`}
                                  type="button"
                                  onClick={() => toggleOcc(entry.hotel.id, occ.label)}
                                >
                                  <span className="me-2">{occ.label}</span>
                                  {result && !result.error && result.rooms !== null && (
                                    <span className="badge bg-secondary fw-normal">
                                      {result.rooms.length} rooms
                                    </span>
                                  )}
                                  {result?.error && (
                                    <span className="badge bg-danger fw-normal">Error</span>
                                  )}
                                  {!result && (
                                    <span className="badge bg-light text-muted fw-normal">
                                      Not scanned
                                    </span>
                                  )}
                                </button>
                              </h2>
                              {isOpen && (
                                <div className="accordion-collapse">
                                  <div className="accordion-body py-2 px-3">
                                    {!result ? (
                                      <p className="text-muted small mb-0">Not scanned</p>
                                    ) : result.error ? (
                                      <p className="text-danger small mb-0">{result.error}</p>
                                    ) : (
                                      <>
                                        {result.rooms && result.rooms.length > 0 ? (
                                          <ul className="list-unstyled mb-0 small">
                                            {result.rooms.map((r, i) => (
                                              <li key={i} className="mb-1">
                                                {r.roomName}
                                                {r.imageMissing && (
                                                  <span className="ms-1 text-warning">
                                                    ⚠ image missing
                                                  </span>
                                                )}
                                              </li>
                                            ))}
                                          </ul>
                                        ) : (
                                          <p className="text-muted small mb-0">No rooms found</p>
                                        )}
                                        {result.screenshot_url && (
                                          <div className="mt-2">
                                            <img
                                              src={result.screenshot_url}
                                              alt={`${entry.hotel.name} ${occ.label}`}
                                              style={{ width: '100%', borderRadius: 4 }}
                                            />
                                          </div>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}

        {!loadingEntries && entries.length === 0 && !entriesError && (
          <p className="text-muted">No data loaded yet.</p>
        )}
      </div>
    </main>
  );
}
