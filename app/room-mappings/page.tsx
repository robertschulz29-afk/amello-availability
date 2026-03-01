'use client';
// app/room-mappings/page.tsx

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';

type Hotel = { id: number; name: string; code: string };
type Mapping = {
  id: number;
  hotel_id: number;
  amello_room: string;
  booking_room: string;
  updated_at: string;
};
type RoomData = {
  mappings: Mapping[];
  amelloRooms: string[];
  bookingRooms: string[];
};

export default function Page() {
  const [hotels, setHotels] = React.useState<Hotel[]>([]);
  const [selectedHotelId, setSelectedHotelId] = React.useState<number | null>(null);
  const [hotelSearch, setHotelSearch] = React.useState('');
  const [roomData, setRoomData] = React.useState<RoomData | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null);

  // New mapping form
  const [newAmello, setNewAmello] = React.useState('');
  const [newBooking, setNewBooking] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  // Edit state
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [editAmello, setEditAmello] = React.useState('');
  const [editBooking, setEditBooking] = React.useState('');
  const [editSaving, setEditSaving] = React.useState(false);

  // Load hotels on mount; also check for ?hotelId= in URL
  React.useEffect(() => {
    fetchJSON('/api/hotels', { cache: 'no-store' })
      .then((data: any) => {
        const arr: Hotel[] = Array.isArray(data) ? data : [];
        arr.sort((a, b) => a.name.localeCompare(b.name));
        setHotels(arr);
        // Pre-select from URL param if present
        const params = new URLSearchParams(window.location.search);
        const urlHotelId = params.get('hotelId');
        if (urlHotelId) {
          setSelectedHotelId(Number(urlHotelId));
        } else if (arr.length > 0) {
          setSelectedHotelId(arr[0].id);
        }
      })
      .catch(() => setError('Failed to load hotels'));
  }, []);

  // Load room data when hotel changes
  const loadRoomData = React.useCallback(async (hotelId: number) => {
    setLoading(true);
    setError(null);
    setRoomData(null);
    try {
      const data: RoomData = await fetchJSON(`/api/room-mappings?hotelId=${hotelId}`, { cache: 'no-store' });
      setRoomData(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load room data');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (selectedHotelId != null) {
      loadRoomData(selectedHotelId);
      setEditingId(null);
      setNewAmello('');
      setNewBooking('');
    }
  }, [selectedHotelId, loadRoomData]);

  // Auto-dismiss success message
  React.useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(null), 3500);
    return () => clearTimeout(t);
  }, [successMsg]);

  const filteredHotels = React.useMemo(() => {
    if (!hotelSearch.trim()) return hotels;
    const term = hotelSearch.toLowerCase();
    return hotels.filter(h =>
      h.name.toLowerCase().includes(term) || h.code.toLowerCase().includes(term)
    );
  }, [hotels, hotelSearch]);

  const selectedHotel = hotels.find(h => h.id === selectedHotelId);

  const addMapping = async () => {
    if (!newAmello || !newBooking || !selectedHotelId) return;
    setSaving(true);
    setError(null);
    try {
      await fetchJSON('/api/room-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotelId: selectedHotelId, amelloRoom: newAmello, bookingRoom: newBooking }),
      });
      setNewAmello('');
      setNewBooking('');
      setSuccessMsg('Mapping added.');
      await loadRoomData(selectedHotelId);
    } catch (e: any) {
      setError(e.message || 'Failed to add mapping');
    } finally {
      setSaving(false);
    }
  };

  const deleteMapping = async (id: number) => {
    if (!selectedHotelId) return;
    if (!confirm('Delete this mapping?')) return;
    try {
      await fetchJSON(`/api/room-mappings?id=${id}`, { method: 'DELETE' });
      setSuccessMsg('Mapping deleted.');
      await loadRoomData(selectedHotelId);
    } catch (e: any) {
      setError(e.message || 'Failed to delete');
    }
  };

  const startEdit = (m: Mapping) => {
    setEditingId(m.id);
    setEditAmello(m.amello_room);
    setEditBooking(m.booking_room);
  };

  const saveEdit = async () => {
    if (!editingId || !selectedHotelId) return;
    setEditSaving(true);
    setError(null);
    try {
      await fetchJSON(`/api/room-mappings?id=${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amelloRoom: editAmello, bookingRoom: editBooking }),
      });
      setEditingId(null);
      setSuccessMsg('Mapping updated.');
      await loadRoomData(selectedHotelId);
    } catch (e: any) {
      setError(e.message || 'Failed to update');
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>
        <div className="d-flex align-items-center gap-3 mb-4 flex-wrap">
          <h1 className="mb-0">Room Name Mappings</h1>
          <a href="/price-comparison" className="btn btn-outline-secondary btn-sm ms-auto">
            ← Back to Price Comparison
          </a>
        </div>
        <p className="text-muted mb-4">
          Map Amello room names to Booking.com room names per hotel. Mappings are used in the Price Comparison page to match rooms across sources.
        </p>

        {successMsg && (
          <div className="alert alert-success alert-dismissible">
            {successMsg}
            <button className="btn-close" onClick={() => setSuccessMsg(null)}></button>
          </div>
        )}
        {error && (
          <div className="alert alert-danger alert-dismissible">
            {error}
            <button className="btn-close" onClick={() => setError(null)}></button>
          </div>
        )}

        {/* Hotel selector */}
        <div className="card mb-4">
          <div className="card-header fw-semibold">Select Hotel</div>
          <div className="card-body d-flex gap-3 flex-wrap">
            <input
              className="form-control"
              style={{ maxWidth: 260 }}
              placeholder="Search hotels…"
              value={hotelSearch}
              onChange={e => setHotelSearch(e.target.value)}
            />
            <select
              className="form-select"
              style={{ maxWidth: 420 }}
              value={selectedHotelId ?? ''}
              onChange={e => setSelectedHotelId(Number(e.target.value))}
            >
              {filteredHotels.map(h => (
                <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
              ))}
            </select>
          </div>
        </div>

        {loading && (
          <div className="text-center my-4">
            <div className="spinner-border text-primary" role="status"></div>
            <div className="mt-2 text-muted">Loading room data…</div>
          </div>
        )}

        {!loading && roomData && selectedHotel && (
          <>
            {/* Add new mapping */}
            <div className="card mb-4">
              <div className="card-header fw-semibold">
                Add Mapping — <span className="fw-normal text-muted">{selectedHotel.name}</span>
              </div>
              <div className="card-body">
                <div className="row g-3 align-items-end">
                  <div className="col-md-5">
                    <label className="form-label fw-semibold">Amello Room Name</label>
                    {roomData.amelloRooms.length > 0 && (
                      <select
                        className="form-select mb-1"
                        value={newAmello}
                        onChange={e => setNewAmello(e.target.value)}
                        disabled={saving}
                      >
                        <option value="">— pick from scan data —</option>
                        {roomData.amelloRooms.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    )}
                    <input
                      className="form-control"
                      placeholder="Or type manually…"
                      value={newAmello}
                      onChange={e => setNewAmello(e.target.value)}
                      disabled={saving}
                    />
                    {roomData.amelloRooms.length === 0 && (
                      <div className="form-text text-warning">No Amello rooms found in scan data yet.</div>
                    )}
                  </div>

                  <div className="col-md-5">
                    <label className="form-label fw-semibold">Booking.com Room Name</label>
                    {roomData.bookingRooms.length > 0 && (
                      <select
                        className="form-select mb-1"
                        value={newBooking}
                        onChange={e => setNewBooking(e.target.value)}
                        disabled={saving}
                      >
                        <option value="">— pick from scan data —</option>
                        {roomData.bookingRooms.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    )}
                    <input
                      className="form-control"
                      placeholder="Or type manually…"
                      value={newBooking}
                      onChange={e => setNewBooking(e.target.value)}
                      disabled={saving}
                    />
                    {roomData.bookingRooms.length === 0 && (
                      <div className="form-text text-warning">No Booking.com rooms found in scan data yet.</div>
                    )}
                  </div>

                  <div className="col-md-2">
                    <button
                      className="btn btn-primary w-100"
                      onClick={addMapping}
                      disabled={saving || !newAmello || !newBooking}
                    >
                      {saving
                        ? <><span className="spinner-border spinner-border-sm me-1"></span>Saving…</>
                        : '+ Add'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Existing mappings */}
            <div className="card">
              <div className="card-header fw-semibold d-flex justify-content-between align-items-center">
                <span>Saved Mappings</span>
                <span className="badge bg-secondary">{roomData.mappings.length}</span>
              </div>
              {roomData.mappings.length === 0 ? (
                <div className="card-body text-muted">No mappings yet for this hotel.</div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm table-striped table-hover mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Amello Room</th>
                        <th>Booking.com Room</th>
                        <th className="text-muted small">Updated</th>
                        <th style={{ width: 100 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {roomData.mappings.map(m => (
                        <tr key={m.id}>
                          {editingId === m.id ? (
                            <>
                              <td>
                                {roomData.amelloRooms.length > 0 && (
                                  <select
                                    className="form-select form-select-sm mb-1"
                                    value={editAmello}
                                    onChange={e => setEditAmello(e.target.value)}
                                    disabled={editSaving}
                                  >
                                    {roomData.amelloRooms.map(r => <option key={r} value={r}>{r}</option>)}
                                    {!roomData.amelloRooms.includes(editAmello) && (
                                      <option value={editAmello}>{editAmello}</option>
                                    )}
                                  </select>
                                )}
                                <input
                                  className="form-control form-control-sm"
                                  value={editAmello}
                                  onChange={e => setEditAmello(e.target.value)}
                                  disabled={editSaving}
                                />
                              </td>
                              <td>
                                {roomData.bookingRooms.length > 0 && (
                                  <select
                                    className="form-select form-select-sm mb-1"
                                    value={editBooking}
                                    onChange={e => setEditBooking(e.target.value)}
                                    disabled={editSaving}
                                  >
                                    {roomData.bookingRooms.map(r => <option key={r} value={r}>{r}</option>)}
                                    {!roomData.bookingRooms.includes(editBooking) && (
                                      <option value={editBooking}>{editBooking}</option>
                                    )}
                                  </select>
                                )}
                                <input
                                  className="form-control form-control-sm"
                                  value={editBooking}
                                  onChange={e => setEditBooking(e.target.value)}
                                  disabled={editSaving}
                                />
                              </td>
                              <td></td>
                              <td>
                                <button className="btn btn-sm btn-success me-1" onClick={saveEdit} disabled={editSaving}>
                                  {editSaving ? <span className="spinner-border spinner-border-sm"></span> : <i className="fa fa-check"></i>}
                                </button>
                                <button className="btn btn-sm btn-secondary" onClick={() => setEditingId(null)} disabled={editSaving}>
                                  <i className="fa fa-times"></i>
                                </button>
                              </td>
                            </>
                          ) : (
                            <>
                              <td>{m.amello_room}</td>
                              <td>{m.booking_room}</td>
                              <td className="text-muted small">{new Date(m.updated_at).toLocaleDateString()}</td>
                              <td>
                                <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => startEdit(m)} title="Edit">
                                  <i className="fa fa-pencil"></i>
                                </button>
                                <button className="btn btn-sm btn-outline-danger" onClick={() => deleteMapping(m.id)} title="Delete">
                                  <i className="fa fa-trash"></i>
                                </button>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
