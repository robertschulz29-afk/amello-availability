'use client';
// app/imagery-mappings/page.tsx

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';

// ── Types ─────────────────────────────────────────────────────────────────────

type ImageryMapping = {
  id: number;
  hotel_id: number;
  imagery_room_name: string;
  scan_room_name: string;
  updated_at: string;
};

type HotelData = {
  id: number;
  name: string;
  code: string;
  mappings: ImageryMapping[];
  imageryRooms: { room_name: string; image_url: string }[];
  scanRooms: string[];
};

// ── Per-imagery-room row ───────────────────────────────────────────────────────

type ImageryRowProps = {
  imageryRoom: { room_name: string; image_url: string };
  mapping: ImageryMapping | undefined;
  scanRooms: string[];
  onSave: (imageryRoomName: string, scanRoomName: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
};

function ImageryRow({ imageryRoom, mapping, scanRooms, onSave, onDelete }: ImageryRowProps) {
  const [editing, setEditing] = React.useState(false);
  const [selected, setSelected] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const openEdit = () => {
    setSelected(mapping?.scan_room_name ?? '');
    setEditing(true);
  };

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await onSave(imageryRoom.room_name, selected);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const editDropdown = (
    <div className="d-flex gap-1 align-items-center mt-1">
      <select
        className="form-select form-select-sm"
        value={selected}
        onChange={e => setSelected(e.target.value)}
        disabled={busy}
        style={{ maxWidth: 280 }}
      >
        <option value="">— select scan room —</option>
        {scanRooms.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <button className="btn btn-sm btn-success" onClick={save} disabled={busy || !selected}>
        {busy ? <span className="spinner-border spinner-border-sm"></span> : '✓'}
      </button>
      <button className="btn btn-sm btn-outline-secondary" onClick={() => setEditing(false)} disabled={busy}>✕</button>
    </div>
  );

  return (
    <tr>
      <td className="align-top py-2">
        <div className="d-flex align-items-center gap-2">
          {imageryRoom.image_url && (
            <img
              src={imageryRoom.image_url}
              alt={imageryRoom.room_name}
              style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
            />
          )}
          <span className="small fw-semibold">{imageryRoom.room_name}</span>
        </div>
      </td>
      <td className="align-top py-2">
        {!editing ? (
          mapping ? (
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <span className="small">{mapping.scan_room_name}</span>
              <button
                className="btn btn-outline-secondary"
                style={{ padding: '1px 6px', fontSize: '0.7rem' }}
                onClick={openEdit}
              >
                <i className="fa fa-pencil"></i>
              </button>
              <button
                className="btn btn-outline-danger"
                style={{ padding: '1px 6px', fontSize: '0.7rem' }}
                onClick={() => onDelete(mapping.id)}
              >
                <i className="fa fa-times"></i>
              </button>
            </div>
          ) : (
            <button className="btn btn-sm btn-outline-warning" onClick={openEdit}>+ Map scan room</button>
          )
        ) : editDropdown}
      </td>
    </tr>
  );
}

// ── Per-hotel section ─────────────────────────────────────────────────────────

function HotelSection({
  hotel,
  onMappingChange,
}: {
  hotel: HotelData;
  onMappingChange: () => void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [msg, setMsg] = React.useState<{ text: string; ok: boolean } | null>(null);

  React.useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  const mappingByScanRoom = React.useMemo(() => {
    const map = new Map<string, ImageryMapping>();
    for (const m of hotel.mappings) map.set(m.scan_room_name, m);
    return map;
  }, [hotel.mappings]);

  const unmappedScanCount = hotel.scanRooms.filter(r => !mappingByScanRoom.has(r)).length;

  const handleSave = async (imageryRoomName: string, scanRoomName: string) => {
    try {
      await fetchJSON('/api/imagery-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotelId: hotel.id, imageryRoomName, scanRoomName }),
      });
      setMsg({ text: 'Saved.', ok: true });
      onMappingChange();
    } catch (e: any) {
      setMsg({ text: e.message || 'Failed to save', ok: false });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Remove this mapping?')) return;
    try {
      await fetchJSON(`/api/imagery-mappings?id=${id}`, { method: 'DELETE' });
      setMsg({ text: 'Mapping removed.', ok: true });
      onMappingChange();
    } catch (e: any) {
      setMsg({ text: e.message || 'Failed to delete', ok: false });
    }
  };

  return (
    <div className="card mb-3">
      <div
        className="card-header d-flex align-items-center gap-2 flex-wrap"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setCollapsed(c => !c)}
      >
        <span className="fw-semibold">{hotel.name}</span>
        <span className="text-muted small">({hotel.code})</span>
        <div className="ms-auto d-flex align-items-center gap-2 flex-wrap">
          {unmappedScanCount > 0 && (
            <span className="badge text-bg-warning">{unmappedScanCount} unmapped scan rooms</span>
          )}
          {unmappedScanCount === 0 && hotel.scanRooms.length > 0 && (
            <span className="badge text-bg-success">fully mapped</span>
          )}
          {hotel.imageryRooms.length === 0 && (
            <span className="badge text-bg-secondary border">no imagery data</span>
          )}
          <span className="text-muted small">{collapsed ? '▼' : '▲'}</span>
        </div>
      </div>

      {!collapsed && (
        <div className="card-body p-0">
          {msg && (
            <div className={`alert py-2 small mb-0 rounded-0 ${msg.ok ? 'alert-success' : 'alert-danger'}`}>
              {msg.text}
            </div>
          )}

          {hotel.imageryRooms.length === 0 ? (
            <p className="text-muted small m-3">No imagery data yet. Run a hotel sync first.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm table-hover mb-0 align-middle">
                <thead className="table-light">
                  <tr>
                    <th style={{ width: '45%' }}>Imagery Room</th>
                    <th>Scan Room</th>
                  </tr>
                </thead>
                <tbody>
                  {hotel.imageryRooms.map(imageryRoom => {
                    const existingMapping = hotel.mappings.find(
                      m => m.imagery_room_name === imageryRoom.room_name
                    );
                    return (
                      <ImageryRow
                        key={imageryRoom.room_name}
                        imageryRoom={imageryRoom}
                        mapping={existingMapping}
                        scanRooms={hotel.scanRooms}
                        onSave={handleSave}
                        onDelete={handleDelete}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Page() {
  const [hotels, setHotels]   = React.useState<HotelData[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError]     = React.useState<string | null>(null);
  const [search, setSearch]   = React.useState('');
  type FilterBool = 'all' | 'true' | 'false';
  const [filterActive,   setFilterActive]   = React.useState<FilterBool>('true');
  const [filterBookable, setFilterBookable] = React.useState<FilterBool>('true');

  const load = React.useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterActive   !== 'all') params.set('active',   filterActive);
      if (filterBookable !== 'all') params.set('bookable', filterBookable);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const data = await fetchJSON(`/api/imagery-mappings${qs}`, { cache: 'no-store' });
      setHotels(data.hotels ?? []);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [filterActive, filterBookable]);

  React.useEffect(() => { load(); }, [load]);

  const filtered = React.useMemo(() => {
    if (!search.trim()) return hotels;
    const term = search.toLowerCase();
    return hotels.filter(h => h.name.toLowerCase().includes(term) || h.code.toLowerCase().includes(term));
  }, [hotels, search]);

  const totalUnmapped = React.useMemo(() =>
    hotels.reduce((acc, h) => {
      const mapped = new Set(h.mappings.map(m => m.scan_room_name));
      return acc + h.scanRooms.filter(r => !mapped.has(r)).length;
    }, 0),
    [hotels],
  );

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>

        <div className="d-flex align-items-center gap-3 mb-4 flex-wrap">
          <h1 className="h4 mb-0">Imagery Mappings</h1>
          {!loading && totalUnmapped > 0 && (
            <span className="badge text-bg-warning fs-6">{totalUnmapped} unmapped scan rooms</span>
          )}
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <div className="mb-3 d-flex flex-wrap gap-2 align-items-center">
          <input
            className="form-control"
            style={{ maxWidth: 280 }}
            placeholder="Filter hotels…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div>
            <label className="form-label fw-semibold mb-1 d-block small">Active</label>
            <div className="btn-group btn-group-sm" role="group">
              {(['all', 'true', 'false'] as FilterBool[]).map(v => (
                <button key={v} type="button" className={`btn ${filterActive === v ? 'btn-secondary' : 'btn-outline-secondary'}`} onClick={() => setFilterActive(v)}>
                  {v === 'all' ? 'All' : v === 'true' ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="form-label fw-semibold mb-1 d-block small">Bookable</label>
            <div className="btn-group btn-group-sm" role="group">
              {(['all', 'true', 'false'] as FilterBool[]).map(v => (
                <button key={v} type="button" className={`btn ${filterBookable === v ? 'btn-secondary' : 'btn-outline-secondary'}`} onClick={() => setFilterBookable(v)}>
                  {v === 'all' ? 'All' : v === 'true' ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading && (
          <div className="text-center my-5">
            <div className="spinner-border text-primary" role="status"></div>
            <div className="mt-2 text-muted">Loading imagery mappings…</div>
          </div>
        )}

        {!loading && filtered.map(hotel => (
          <HotelSection
            key={hotel.id}
            hotel={hotel}
            onMappingChange={load}
          />
        ))}

        {!loading && filtered.length === 0 && (
          <p className="text-muted">No hotels match the filter.</p>
        )}
      </div>
    </main>
  );
}
