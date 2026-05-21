// app/rooms-cr-api/page.tsx
'use client';

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';

// ── Types ─────────────────────────────────────────────────────────────────────

type ScanRow = {
  id: number;
  scanned_at: string;
  base_checkin: string | null;
  fixed_checkout: string | null;
  status: string;
};

type Hotel = {
  id: number;
  name: string;
  code: string;
};

type RoomImageryItem = {
  room_name: string;
  image_url: string;
};

type RoomsCrApiData = {
  screenshot: { url: string } | null;
  roomImagery: RoomImageryItem[];
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

// Group imagery by room_name — schema enforces unique (hotel_id, room_name),
// so each room has exactly one image_url.
function groupByRoom(items: RoomImageryItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    map.set(item.room_name, item.image_url);
  }
  return map;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function RoomsCrApiPage() {
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [hotels, setHotels] = React.useState<Hotel[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);
  const [hotelFilter, setHotelFilter] = React.useState('');
  const [selectedHotelId, setSelectedHotelId] = React.useState<number | null>(null);
  const [data, setData] = React.useState<RoomsCrApiData | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // ── Load scans and hotels on mount ────────────────────────────────────────
  React.useEffect(() => {
    fetchJSON('/api/scans', { cache: 'no-store' })
      .then((list: ScanRow[]) => {
        const sorted = Array.isArray(list) ? [...list].sort((a, b) => b.id - a.id) : [];
        setScans(sorted);
        if (sorted.length > 0) setSelectedScanId(sorted[0].id);
      })
      .catch(() => setError('Failed to load scans'));

    fetchJSON('/api/hotels', { cache: 'no-store' })
      .then((list: Hotel[]) => {
        setHotels(Array.isArray(list) ? list : []);
      })
      .catch(() => setError('Failed to load hotels'));
  }, []);

  // ── Fetch data when both scan + hotel are selected ────────────────────────
  React.useEffect(() => {
    if (!selectedScanId || !selectedHotelId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetchJSON(`/api/rooms-cr-api?scanId=${selectedScanId}&hotelId=${selectedHotelId}`, {
      cache: 'no-store',
    })
      .then((d: RoomsCrApiData) => { setData(d); })
      .catch((e: Error) => { setError(e.message || 'Failed to load data'); })
      .finally(() => setLoading(false));
  }, [selectedScanId, selectedHotelId]);

  // ── Filtered hotel list ───────────────────────────────────────────────────
  const filteredHotels = React.useMemo(() => {
    const q = hotelFilter.trim().toLowerCase();
    if (!q) return hotels;
    return hotels.filter(
      h => h.name.toLowerCase().includes(q) || h.code.toLowerCase().includes(q),
    );
  }, [hotels, hotelFilter]);

  const roomGroups = data ? groupByRoom(data.roomImagery) : null;

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
          <div className="card-body row g-3">
            {/* Scan selector */}
            <div className="col-sm-5">
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

            {/* Hotel filter + selector */}
            <div className="col-sm-7">
              <label className="form-label fw-semibold">Hotel</label>
              <input
                type="text"
                className="form-control mb-1"
                placeholder="Filter hotels…"
                value={hotelFilter}
                onChange={e => { setHotelFilter(e.target.value); setSelectedHotelId(null); }}
              />
              <select
                className="form-select"
                size={5}
                value={selectedHotelId ?? ''}
                onChange={e => setSelectedHotelId(Number(e.target.value) || null)}
              >
                <option value="">— select a hotel —</option>
                {filteredHotels.map(h => (
                  <option key={h.id} value={h.id}>
                    {h.name} ({h.code})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ── Content area ── */}
        {loading && (
          <div className="text-center py-5">
            <div className="spinner-border text-secondary" role="status">
              <span className="visually-hidden">Loading…</span>
            </div>
          </div>
        )}

        {!loading && selectedScanId && selectedHotelId && data && (
          <div className="row g-4">
            {/* Left column — screenshot */}
            <div className="col-12 col-md-6">
              <div className="card h-100">
                <div className="card-header fw-semibold">
                  <i className="fas fa-camera me-2" />
                  Scan Screenshot
                </div>
                <div className="card-body">
                  {data.screenshot ? (
                    <img
                      src={data.screenshot.url}
                      alt="Hotel page screenshot"
                      style={{ width: '100%', borderRadius: 4 }}
                    />
                  ) : (
                    <p className="text-muted mb-0">No screenshot captured for this scan.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Right column — room imagery */}
            <div className="col-12 col-md-6">
              <div className="card h-100">
                <div className="card-header fw-semibold">
                  <i className="fas fa-images me-2" />
                  Room Imagery
                </div>
                <div className="card-body">
                  {roomGroups && roomGroups.size > 0 ? (
                    Array.from(roomGroups.entries()).map(([roomName, url]) => (
                      <div key={roomName} className="mb-4">
                        <h6 className="fw-semibold mb-2">{roomName}</h6>
                        <img
                          src={url}
                          alt={roomName}
                          style={{ width: '100%', maxWidth: 260, borderRadius: 4 }}
                        />
                      </div>
                    ))
                  ) : (
                    <p className="text-muted mb-0">No imagery data for this hotel.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {!loading && (!selectedScanId || !selectedHotelId) && (
          <p className="text-muted">Select a scan and a hotel to view data.</p>
        )}
      </div>
    </main>
  );
}
