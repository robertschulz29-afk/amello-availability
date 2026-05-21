'use client';

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';
import { HotelCombobox } from '@/app/components/HotelCombobox';

type ScanRow = {
  id: number;
  scanned_at: string;
  base_checkin: string | null;
  fixed_checkout: string | null;
  status: string;
  store_screenshot?: boolean;
};

type HotelEntry = {
  hotel: { id: number; name: string; code: string; brand: string | null; active: boolean | null; bookable: boolean | null };
  screenshot: { url: string } | null;
  roomImagery: Array<{ room_name: string; image_url: string }>;
  scanRoomNames: string[] | null;
  crRoomNames: string[] | null;
  scanRoomCount: number | null;
  crRoomCount: number | null;
};

type FilterBool = 'all' | 'true' | 'false';

function fmt(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function RoomsCrApiPage() {
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);
  const [entries, setEntries] = React.useState<HotelEntry[]>([]);
  const [selectedHotelIds, setSelectedHotelIds] = React.useState<number[]>([]);
  const [countFilter, setCountFilter] = React.useState<'all' | 'crapi_gt' | 'scan_gt' | 'equal'>('all');
  const [filterActive, setFilterActive] = React.useState<FilterBool>('true');
  const [filterBookable, setFilterBookable] = React.useState<FilterBool>('true');
  const [expandedImages, setExpandedImages] = React.useState<Set<number>>(new Set());
  const [screenshotBusy, setScreenshotBusy] = React.useState(false);
  const [screenshotMsg, setScreenshotMsg] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetchJSON('/api/scans', { cache: 'no-store' })
      .then((list: ScanRow[]) => {
        const sorted = Array.isArray(list) ? [...list].sort((a, b) => b.id - a.id) : [];
        setScans(sorted);
        if (sorted.length > 0) setSelectedScanId(sorted[0].id);
      })
      .catch(() => setError('Failed to load scans'));
  }, []);

  React.useEffect(() => {
    if (!selectedScanId) { setEntries([]); return; }
    setLoading(true);
    setError(null);
    fetchJSON(`/api/rooms-cr-api?scanId=${selectedScanId}`, { cache: 'no-store' })
      .then((data: HotelEntry[]) => setEntries(Array.isArray(data) ? data : []))
      .catch((e: Error) => setError(e.message || 'Failed to load data'))
      .finally(() => setLoading(false));
  }, [selectedScanId]);

  const allHotels = React.useMemo(
    () => entries.map(e => ({ id: e.hotel.id, name: e.hotel.name, code: e.hotel.code, brand: e.hotel.brand ?? undefined })),
    [entries],
  );

  const visibleEntries = React.useMemo(() => {
    let list = entries;

    if (filterActive !== 'all') {
      const want = filterActive === 'true';
      list = list.filter(e => e.hotel.active === want);
    }
    if (filterBookable !== 'all') {
      const want = filterBookable === 'true';
      list = list.filter(e => e.hotel.bookable === want);
    }
    if (selectedHotelIds.length > 0) {
      const idSet = new Set(selectedHotelIds);
      list = list.filter(e => idSet.has(e.hotel.id));
    }
    if (countFilter === 'crapi_gt') {
      list = list.filter(e => e.crRoomCount !== null && e.scanRoomCount !== null && e.crRoomCount > e.scanRoomCount);
    } else if (countFilter === 'scan_gt') {
      list = list.filter(e => e.crRoomCount !== null && e.scanRoomCount !== null && e.scanRoomCount > e.crRoomCount);
    } else if (countFilter === 'equal') {
      list = list.filter(e => e.crRoomCount !== null && e.scanRoomCount !== null && e.crRoomCount === e.scanRoomCount);
    }

    return list;
  }, [entries, selectedHotelIds, countFilter, filterActive, filterBookable]);

  async function captureScreenshots() {
    if (!selectedScanId) return;
    setScreenshotBusy(true);
    setScreenshotMsg(null);

    let offset = 0;
    let totalProcessed = 0;
    let totalErrors = 0;
    let grandTotal = 0;

    try {
      while (true) {
        const res = await fetch(`/api/scans/${selectedScanId}/screenshot-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offset, limit: 3 }),
        });

        if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) {
          const text = await res.text().catch(() => '');
          throw new Error(`Server error (${res.status})${text ? ': ' + text.slice(0, 100) : ''}`);
        }

        const json = await res.json();
        totalProcessed += json.processed ?? 0;
        totalErrors += json.errors ?? 0;
        grandTotal = json.total ?? grandTotal;

        setScreenshotMsg(`Capturing… ${totalProcessed + totalErrors} / ${grandTotal} done`);

        if (!json.hasMore) break;
        offset = json.nextOffset;
      }

      setScreenshotMsg(`Done — ${totalProcessed} captured, ${totalErrors} errors (${grandTotal} total).`);
      const data = await fetchJSON(`/api/rooms-cr-api?scanId=${selectedScanId}`, { cache: 'no-store' });
      setEntries(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setScreenshotMsg(`Error: ${e.message}`);
    } finally {
      setScreenshotBusy(false);
    }
  }

  function exportCsv() {
    const headers = ['Hotel', 'Code', 'Active', 'Bookable', 'Scan Rooms', 'Scan Room Names', 'CR-API Rooms', 'CR-API Room Names'];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = visibleEntries.map(e => [
      escape(e.hotel.name),
      escape(e.hotel.code),
      e.hotel.active === true ? 'Yes' : e.hotel.active === false ? 'No' : '',
      e.hotel.bookable === true ? 'Yes' : e.hotel.bookable === false ? 'No' : '',
      String(e.scanRoomCount ?? ''),
      escape((e.scanRoomNames ?? []).join('; ')),
      String(e.crRoomCount ?? ''),
      escape((e.crRoomNames ?? []).join('; ')),
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rooms-cr-api-scan${selectedScanId ?? ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function triBtn(label: string, value: FilterBool, current: FilterBool, set: (v: FilterBool) => void) {
    const active = current === value;
    const cls = value === 'true' ? 'success' : value === 'false' ? 'danger' : 'secondary';
    return (
      <button
        key={value}
        type="button"
        className={`btn btn-sm btn-outline-${cls}${active ? ' active' : ''}`}
        onClick={() => set(value)}
      >{label}</button>
    );
  }

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>
        <h4 className="mb-3">Rooms / CR-API</h4>

        {error && (
          <div className="alert alert-danger alert-dismissible" role="alert">
            {error}
            <button type="button" className="btn-close" onClick={() => setError(null)} />
          </div>
        )}

        {/* ── Filters ── */}
        <div className="card mb-4">
          <div className="card-body row g-3 align-items-end">
            {/* Scan */}
            <div className="col-sm-4">
              <label className="form-label fw-semibold">Scan</label>
              <select
                className="form-select form-select-sm"
                value={selectedScanId ?? ''}
                onChange={e => setSelectedScanId(Number(e.target.value) || null)}
              >
                <option value="">— select a scan —</option>
                {scans.map(s => (
                  <option key={s.id} value={s.id}>
                    #{s.id} — {fmt(s.scanned_at)}
                    {s.base_checkin ? ` (check-in: ${s.base_checkin})` : ''}
                    {' '}[{s.status}]
                  </option>
                ))}
              </select>
            </div>

            {/* Screenshot capture button */}
            {selectedScanId && scans.find(s => s.id === selectedScanId)?.store_screenshot && (
              <div className="col-sm-auto">
                <label className="form-label fw-semibold d-block">Screenshots</label>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={captureScreenshots}
                  disabled={screenshotBusy}
                >
                  {screenshotBusy
                    ? <><span className="spinner-border spinner-border-sm me-1" />Capturing…</>
                    : <><i className="fas fa-camera me-1" />Capture now</>}
                </button>
                {screenshotMsg && <div className="small mt-1 text-muted">{screenshotMsg}</div>}
              </div>
            )}

            {/* Hotel combobox */}
            <div className="col-sm-3">
              <label className="form-label fw-semibold">
                Hotel
                {selectedHotelIds.length > 0 && (
                  <span className="ms-2 text-muted fw-normal small">({selectedHotelIds.length} of {allHotels.length})</span>
                )}
              </label>
              <HotelCombobox
                hotels={allHotels}
                selectedIds={selectedHotelIds}
                onChange={setSelectedHotelIds}
                placeholder="All Hotels"
                size="sm"
              />
            </div>

            {/* Active filter */}
            <div className="col-sm-auto">
              <label className="form-label fw-semibold d-block">Active</label>
              <div className="btn-group btn-group-sm">
                {triBtn('All', 'all', filterActive, setFilterActive)}
                {triBtn('Yes', 'true', filterActive, setFilterActive)}
                {triBtn('No', 'false', filterActive, setFilterActive)}
              </div>
            </div>

            {/* Bookable filter */}
            <div className="col-sm-auto">
              <label className="form-label fw-semibold d-block">Bookable</label>
              <div className="btn-group btn-group-sm">
                {triBtn('All', 'all', filterBookable, setFilterBookable)}
                {triBtn('Yes', 'true', filterBookable, setFilterBookable)}
                {triBtn('No', 'false', filterBookable, setFilterBookable)}
              </div>
            </div>

            {/* Room count filter */}
            <div className="col-sm-auto">
              <label className="form-label fw-semibold d-block">Room count</label>
              <div className="btn-group btn-group-sm">
                <button type="button" className={`btn btn-outline-secondary${countFilter === 'all' ? ' active' : ''}`} onClick={() => setCountFilter('all')}>All</button>
                <button type="button" className={`btn btn-outline-primary${countFilter === 'crapi_gt' ? ' active' : ''}`} onClick={() => setCountFilter('crapi_gt')} title="CR-API has more room types than scan">CR-API &gt; Scan</button>
                <button type="button" className={`btn btn-outline-success${countFilter === 'equal' ? ' active' : ''}`} onClick={() => setCountFilter('equal')} title="Room counts match">Equal</button>
                <button type="button" className={`btn btn-outline-warning${countFilter === 'scan_gt' ? ' active' : ''}`} onClick={() => setCountFilter('scan_gt')} title="Scan has more room types than CR-API">Scan &gt; CR-API</button>
              </div>
            </div>

            {/* Export */}
            <div className="col-sm-auto ms-auto">
              <label className="form-label fw-semibold d-block">&nbsp;</label>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={exportCsv}
                disabled={visibleEntries.length === 0}
              >
                <i className="fas fa-download me-1" />Export CSV
              </button>
            </div>
          </div>
        </div>

        {/* ── Loading ── */}
        {loading && (
          <div className="text-center py-5">
            <div className="spinner-border text-secondary" role="status">
              <span className="visually-hidden">Loading…</span>
            </div>
          </div>
        )}

        {!loading && !selectedScanId && (
          <p className="text-muted">Select a scan to view data.</p>
        )}

        {!loading && selectedScanId && visibleEntries.length === 0 && (
          <p className="text-muted">No hotels match the current filters.</p>
        )}

        {/* ── Hotel cards ── */}
        {!loading && visibleEntries.map(entry => (
          <div key={entry.hotel.id} className="card mb-4">
            {/* Header */}
            <div className="card-header fw-semibold d-flex align-items-center gap-3">
              <span>
                {entry.hotel.name}
                <span className="ms-2 text-muted fw-normal small">{entry.hotel.code}</span>
              </span>
              <span className="ms-auto d-flex gap-2">
                <span className="badge bg-secondary fw-normal" title="Distinct room types from amello scan results">
                  Scan: {entry.scanRoomCount ?? '—'} rooms
                </span>
                <span className="badge bg-primary fw-normal" title="Distinct room types from CR-API imagery">
                  CR-API: {entry.crRoomCount ?? '—'} rooms
                </span>
              </span>
            </div>

            <div className="card-body">
              {/* Room name lists */}
              <div className="row g-3 mb-3">
                <div className="col-12 col-md-6">
                  <div className="fw-semibold small mb-1">Scan room names</div>
                  {entry.scanRoomNames && entry.scanRoomNames.length > 0 ? (
                    <ul className="list-unstyled mb-0 small">
                      {entry.scanRoomNames.map(n => <li key={n} className="text-muted">{n}</li>)}
                    </ul>
                  ) : (
                    <span className="text-muted small">None</span>
                  )}
                </div>
                <div className="col-12 col-md-6">
                  <div className="fw-semibold small mb-1">CR-API room names</div>
                  {entry.crRoomNames && entry.crRoomNames.length > 0 ? (
                    <ul className="list-unstyled mb-0 small">
                      {entry.crRoomNames.map(n => <li key={n} className="text-muted">{n}</li>)}
                    </ul>
                  ) : (
                    <span className="text-muted small">None</span>
                  )}
                </div>
              </div>

              <div className="mt-2">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => setExpandedImages(prev => {
                    const next = new Set(prev);
                    if (next.has(entry.hotel.id)) next.delete(entry.hotel.id);
                    else next.add(entry.hotel.id);
                    return next;
                  })}
                >
                  <i className={`fas fa-chevron-${expandedImages.has(entry.hotel.id) ? 'up' : 'down'} me-1`} />
                  {expandedImages.has(entry.hotel.id) ? 'Hide' : 'Show'} images
                </button>
              </div>

              {expandedImages.has(entry.hotel.id) && (
                <>
                  <hr className="my-3" />
                  <div className="row g-4">
                    <div className="col-12 col-md-6">
                      <div className="fw-semibold small mb-2"><i className="fas fa-camera me-1" />Scan Screenshot</div>
                      {entry.screenshot ? (
                        <img src={entry.screenshot.url} alt={`${entry.hotel.name} screenshot`} style={{ width: '100%', borderRadius: 4 }} />
                      ) : (
                        <p className="text-muted mb-0 small">No screenshot captured for this scan.</p>
                      )}
                    </div>

                    <div className="col-12 col-md-6">
                      <div className="fw-semibold small mb-2"><i className="fas fa-images me-1" />Room Imagery</div>
                      {entry.roomImagery.length > 0 ? (
                        entry.roomImagery.map(item => (
                          <div key={item.room_name} className="mb-3">
                            <div className="small fw-semibold mb-1">{item.room_name}</div>
                            <img src={item.image_url} alt={item.room_name} style={{ width: '100%', maxWidth: 260, borderRadius: 4 }} />
                          </div>
                        ))
                      ) : (
                        <p className="text-muted mb-0 small">No imagery data for this hotel.</p>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
