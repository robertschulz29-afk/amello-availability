'use client';

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';
import { HotelCombobox } from '@/app/components/HotelCombobox';
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
  rooms: Array<{ roomId: string; roomCode: string; roomName: string; imageMissing: boolean }> | null;
  screenshot_url: string | null;
  error: string | null;
};

type HotelEntry = {
  hotel: { id: number; name: string; code: string; brand: string | null; region: string | null; country: string | null };
  crRooms: CrRoom[];
  playwrightScanId: number | null;
  playwrightResults: Record<string, PlaywrightOccResult> | null;
};

type GroupBy = 'none' | 'brand' | 'region';
type AttentionFilter = 'all' | 'attention' | 'fixable';
type Quality = 'perfect' | 'verygood' | 'good' | 'mediocre' | 'poor' | 'horrible';
type QualityFilter = 'all' | Quality;

function hasAttention(entry: HotelEntry): boolean {
  if (!entry.playwrightResults) return false;
  return Object.values(entry.playwrightResults).some(r => r.rooms?.some(rm => rm.imageMissing));
}

function isFixable(entry: HotelEntry): boolean {
  const hasMissingImg = Object.values(entry.playwrightResults ?? {}).some(r => r.rooms?.some(rm => rm.imageMissing));
  const hasCrImages = entry.crRooms.some(r => r.image_url);
  return hasMissingImg && hasCrImages;
}

function computeQuality(entry: HotelEntry): Quality | null {
  if (!entry.playwrightResults) return null;

  // Collect unique scan rooms across all occupancies; a room "has image" if !imageMissing in any occupancy
  const scanRooms = new Map<string, boolean>();
  for (const result of Object.values(entry.playwrightResults)) {
    for (const r of result.rooms ?? []) {
      const hasImage = !r.imageMissing;
      if (!scanRooms.has(r.roomName) || hasImage) scanRooms.set(r.roomName, hasImage);
    }
  }
  if (scanRooms.size === 0) return null;

  const withImg = [...scanRooms.values()].filter(Boolean).length;
  const ratio = withImg / scanRooms.size;

  if (withImg === 0) return 'horrible';
  if (ratio < 0.5) return 'poor';
  if (withImg < scanRooms.size) return 'mediocre';

  // All scan rooms have images — check CR-API coverage
  const crNamesLower = new Set(entry.crRooms.map(r => r.name.trim().toLowerCase()));
  const crNamesWithImgLower = new Set(entry.crRooms.filter(r => r.image_url).map(r => r.name.trim().toLowerCase()));
  const scanNamesLower = [...scanRooms.keys()].map(n => n.trim().toLowerCase());

  const hasUnmappedCrWithImg = [...crNamesWithImgLower].some(n => !scanNamesLower.includes(n));
  if (hasUnmappedCrWithImg) return 'good';

  const allNamesMatch = scanNamesLower.every(n => crNamesLower.has(n));
  return allNamesMatch ? 'perfect' : 'verygood';
}

const QUALITY_LABELS: Record<Quality, string> = {
  perfect:  'Perfect',
  verygood: 'Very good',
  good:     'Good',
  mediocre: 'Mediocre',
  poor:     'Poor',
  horrible: 'Horrible',
};

const QUALITY_COLORS: Record<Quality, string> = {
  perfect:  'success',
  verygood: 'primary',
  good:     'info',
  mediocre: 'warning',
  poor:     'orange',
  horrible: 'danger',
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

  const [expandedOcc, setExpandedOcc] = React.useState<Map<number, Set<string>>>(new Map());

  // ── Filters & grouping ────────────────────────────────────────────────────
  const [selectedHotelIds, setSelectedHotelIds] = React.useState<number[]>([]);
  const [groupBy, setGroupBy] = React.useState<GroupBy>('none');
  const [attentionFilter, setAttentionFilter] = React.useState<AttentionFilter>('all');
  const [qualityFilter, setQualityFilter] = React.useState<QualityFilter>('all');

  const allHotels = React.useMemo(
    () => entries.map(e => ({ id: e.hotel.id, name: e.hotel.name, code: e.hotel.code, brand: e.hotel.brand ?? undefined })),
    [entries],
  );

  const filtered = React.useMemo(() => {
    return entries.filter(e => {
      if (selectedHotelIds.length > 0 && !selectedHotelIds.includes(e.hotel.id)) return false;
      if (attentionFilter === 'attention' && !hasAttention(e)) return false;
      if (attentionFilter === 'fixable' && !isFixable(e)) return false;
      if (qualityFilter !== 'all' && computeQuality(e) !== qualityFilter) return false;
      return true;
    });
  }, [entries, selectedHotelIds, attentionFilter, qualityFilter]);

  const groups = React.useMemo(() => {
    if (groupBy === 'none') {
      return filtered.map(e => ({ key: String(e.hotel.id), label: e.hotel.name, entries: [e] }));
    }
    const map = new Map<string, HotelEntry[]>();
    for (const e of filtered) {
      const key = groupBy === 'brand' ? (e.hotel.brand ?? '(No Brand)') : (e.hotel.region ?? '(No Region)');
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, es]) => ({ key, label: key, entries: es.sort((a, b) => a.hotel.name.localeCompare(b.hotel.name)) }));
  }, [filtered, groupBy]);

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
    setSelectedHotelIds([]);
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

        {/* ── Filters & grouping toolbar ── */}
        <div className="card mb-3">
          <div className="card-body py-2">
            {/* Row 1: Scan selection */}
            <div className="d-flex align-items-end gap-3 pb-2 mb-2 border-bottom">
              <div>
                <label htmlFor="scan-select" className="form-label form-label-sm mb-1 fw-semibold">Scan</label>
                <select id="scan-select" className="form-select form-select-sm" style={{ minWidth: 260 }} value={selectedScanId ?? ''} onChange={e => setSelectedScanId(Number(e.target.value) || null)}>
                  <option value="">— no scan selected —</option>
                  {scans.map(s => (
                    <option key={s.id} value={s.id}>
                      #{s.id} — {s.check_in} — {s.status} ({s.processed}/{s.total})
                    </option>
                  ))}
                </select>
              </div>
              <span className="ms-auto small text-muted align-self-end pb-1">{entries.length} hotel{entries.length !== 1 ? 's' : ''}{filtered.length !== entries.length ? ` (${filtered.length} shown)` : ''}</span>
            </div>
            {/* Row 2: Filters */}
            <div className="d-flex flex-wrap align-items-end gap-3">
              <div>
                <div className="form-label form-label-sm mb-1 fw-semibold" id="lbl-hotels">Hotels</div>
                <HotelCombobox hotels={allHotels} selectedIds={selectedHotelIds} onChange={setSelectedHotelIds} size="sm" />
              </div>
              <div>
                <div className="form-label form-label-sm mb-1 fw-semibold" id="lbl-groupby">Group by</div>
                <div className="btn-group btn-group-sm" role="group" aria-labelledby="lbl-groupby">
                  {(['none', 'brand', 'region'] as GroupBy[]).map(g => (
                    <button key={g} type="button" className={`btn btn-outline-secondary${groupBy === g ? ' active' : ''}`} onClick={() => setGroupBy(g)}>
                      {g === 'none' ? 'Per Hotel' : g.charAt(0).toUpperCase() + g.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="form-label form-label-sm mb-1 fw-semibold" id="lbl-filter">Filter</div>
                <div className="btn-group btn-group-sm" role="group" aria-labelledby="lbl-filter">
                  <button type="button" className={`btn btn-outline-secondary${attentionFilter === 'all' ? ' active' : ''}`} onClick={() => setAttentionFilter('all')}>All</button>
                  <button type="button" className={`btn btn-outline-warning${attentionFilter === 'attention' ? ' active' : ''}`} onClick={() => setAttentionFilter(attentionFilter === 'attention' ? 'all' : 'attention')}>⚠ Attention needed</button>
                  <button type="button" className={`btn btn-outline-info${attentionFilter === 'fixable' ? ' active' : ''}`} onClick={() => setAttentionFilter(attentionFilter === 'fixable' ? 'all' : 'fixable')}>⚡ Fix potential</button>
                </div>
              </div>
              <div>
                <div className="form-label form-label-sm mb-1 fw-semibold" id="lbl-quality">Mapping quality</div>
                <div className="btn-group btn-group-sm flex-wrap" role="group" aria-labelledby="lbl-quality">
                  <button type="button" className={`btn btn-outline-secondary${qualityFilter === 'all' ? ' active' : ''}`} onClick={() => setQualityFilter('all')}>All</button>
                  {(['perfect', 'verygood', 'good', 'mediocre', 'poor', 'horrible'] as Quality[]).map(q => (
                    <button key={q} type="button" className={`btn btn-outline-secondary${qualityFilter === q ? ' active' : ''}`} onClick={() => setQualityFilter(qualityFilter === q ? 'all' : q)}>
                      {QUALITY_LABELS[q]}
                    </button>
                  ))}
                </div>
              </div>
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
        {!loadingEntries && groups.map(group => (
          <div key={group.key}>
            {groupBy !== 'none' && (
              <div className="d-flex align-items-center gap-2 mb-2 mt-3">
                <h6 className="mb-0 fw-bold">{group.label}</h6>
                <span className="badge bg-secondary fw-normal">{group.entries.length}</span>
              </div>
            )}
            {group.entries.map(entry => (
            <div key={entry.hotel.id} className="card mb-3">
              {/* Header */}
              <div className="card-header fw-semibold d-flex align-items-center gap-2 flex-wrap">
                <span>
                  {entry.hotel.name}
                  <span className="ms-2 text-muted fw-normal small">{entry.hotel.code}</span>
                  {entry.hotel.brand && <span className="ms-2 badge bg-light text-dark fw-normal">{entry.hotel.brand}</span>}
                  {entry.hotel.region && <span className="ms-1 text-muted fw-normal small">{entry.hotel.region}{entry.hotel.country ? `, ${entry.hotel.country}` : ''}</span>}
                </span>
                <span className="ms-auto d-flex gap-2 align-items-center">
                  {hasAttention(entry) && <span className="badge bg-warning text-dark">⚠ attention</span>}
                  {isFixable(entry) && <span className="badge bg-info text-dark">⚡ fixable</span>}
                  {(() => { const q = computeQuality(entry); return q ? <span className={`badge bg-${QUALITY_COLORS[q]}${q === 'mediocre' || q === 'poor' ? ' text-dark' : ''} fw-normal`}>{QUALITY_LABELS[q]}</span> : null; })()}
                  <span className="badge bg-primary fw-normal">CR-API: {entry.crRooms.length}</span>
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
                                          <table className="table table-sm table-bordered mb-0 small">
                                            <thead className="table-light">
                                              <tr>
                                                <th style={{ width: '22%' }}>Code</th>
                                                <th>Room name</th>
                                                <th className="text-center" style={{ width: 80 }}>Image</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {result.rooms.map((r, i) => (
                                                <tr key={i}>
                                                  <td className="font-monospace text-muted">{r.roomCode || '—'}</td>
                                                  <td>{r.roomName}</td>
                                                  <td className="text-center">
                                                    {r.imageMissing
                                                      ? <span className="text-danger fw-semibold">No</span>
                                                      : <span className="text-success fw-semibold">Yes</span>}
                                                  </td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
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
          </div>
        ))}

        {!loadingEntries && filtered.length === 0 && !entriesError && (
          <p className="text-muted">{entries.length === 0 ? 'No data loaded yet.' : 'No hotels match the current filters.'}</p>
        )}
      </div>
    </main>
  );
}
