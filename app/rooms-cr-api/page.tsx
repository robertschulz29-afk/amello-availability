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
};

type HotelEntry = {
  hotel: { id: number; name: string; code: string; brand: string | null };
  screenshot: { url: string } | null;
  roomImagery: Array<{ room_name: string; image_url: string }>;
  scanRoomCount: number | null;
  crRoomCount: number | null;
};

function fmt(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function RoomsCrApiPage() {
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);
  const [entries, setEntries] = React.useState<HotelEntry[]>([]);
  const [selectedHotelIds, setSelectedHotelIds] = React.useState<number[]>([]);
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

  // Hotels list derived from entries (already sorted by name from API)
  const allHotels = React.useMemo(
    () => entries.map(e => ({ id: e.hotel.id, name: e.hotel.name, code: e.hotel.code, brand: e.hotel.brand ?? undefined })),
    [entries],
  );

  // When selectedHotelIds is empty → show all (same behaviour as hotels page)
  const visibleEntries = React.useMemo(() => {
    if (selectedHotelIds.length === 0) return entries;
    const idSet = new Set(selectedHotelIds);
    return entries.filter(e => idSet.has(e.hotel.id));
  }, [entries, selectedHotelIds]);

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

        {/* ── Selectors ── */}
        <div className="card mb-4">
          <div className="card-body row g-3 align-items-end">
            <div className="col-sm-6">
              <label className="form-label fw-semibold">Scan</label>
              <select
                className="form-select"
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

            <div className="col-sm-6">
              <label className="form-label fw-semibold">
                Hotel filter
                {selectedHotelIds.length > 0 && (
                  <span className="ms-2 text-muted fw-normal small">
                    ({selectedHotelIds.length} of {allHotels.length})
                  </span>
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

        {/* ── Hotel cards ── */}
        {!loading && !selectedScanId && (
          <p className="text-muted">Select a scan to view data.</p>
        )}

        {!loading && selectedScanId && visibleEntries.length === 0 && (
          <p className="text-muted">No hotels found.</p>
        )}

        {!loading && visibleEntries.map(entry => (
          <div key={entry.hotel.id} className="card mb-4">
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
              <div className="row g-4">
                {/* Left column — screenshot */}
                <div className="col-12 col-md-6">
                  <div className="fw-semibold small mb-2">
                    <i className="fas fa-camera me-1" />Scan Screenshot
                  </div>
                  {entry.screenshot ? (
                    <img
                      src={entry.screenshot.url}
                      alt={`${entry.hotel.name} screenshot`}
                      style={{ width: '100%', borderRadius: 4 }}
                    />
                  ) : (
                    <p className="text-muted mb-0 small">No screenshot captured for this scan.</p>
                  )}
                </div>

                {/* Right column — room imagery */}
                <div className="col-12 col-md-6">
                  <div className="fw-semibold small mb-2">
                    <i className="fas fa-images me-1" />Room Imagery
                  </div>
                  {entry.roomImagery.length > 0 ? (
                    entry.roomImagery.map(item => (
                      <div key={item.room_name} className="mb-3">
                        <div className="small fw-semibold mb-1">{item.room_name}</div>
                        <img
                          src={item.image_url}
                          alt={item.room_name}
                          style={{ width: '100%', maxWidth: 260, borderRadius: 4 }}
                        />
                      </div>
                    ))
                  ) : (
                    <p className="text-muted mb-0 small">No imagery data for this hotel.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
