// app/hotels/page.tsx
'use client';

import * as React from 'react';

type Hotel = { 
  id: number; 
  name: string; 
  code: string; 
  brand?: string; 
  region?: string; 
  country?: string;
  booking_url?: string | null;
  tuiamello_url?: string | null;
  expedia_url?: string | null;
};

async function fetchJSON(input: RequestInfo, init?: RequestInit) {
  const r = await fetch(input, init);
  const text = await r.text();
  if (!r.ok) {
    try { const j = JSON.parse(text); throw new Error(j.error || r.statusText); }
    catch { throw new Error(text || r.statusText); }
  }
  return text ? JSON.parse(text) : null;
}

function isValidUrl(urlString: string): boolean {
  if (!urlString.trim()) return true; // Empty URLs are valid (optional)
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const SUCCESS_MESSAGE_TIMEOUT_MS = 5000;

export default function Page() {
  const [hotels, setHotels] = React.useState<Hotel[]>([]);
  const [hName, setHName] = React.useState('');
  const [hCode, setHCode] = React.useState('');
  const [hBrand, setHBrand] = React.useState('');
  const [hRegion, setHRegion] = React.useState('');
  const [hCountry, setHCountry] = React.useState('');
  const [hBookingUrl, setHBookingUrl] = React.useState('');
  const [hTuiamelloUrl, setHTuiamelloUrl] = React.useState('');
  const [hExpediaUrl, setHExpediaUrl] = React.useState('');
  const [hError, setHError] = React.useState<string | null>(null);
  const [hBusy, setHBusy] = React.useState(false);
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null);

  // Editing state
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [editBrand, setEditBrand] = React.useState('');
  const [editRegion, setEditRegion] = React.useState('');
  const [editCountry, setEditCountry] = React.useState('');
  const [editBookingUrl, setEditBookingUrl] = React.useState('');
  const [editTuiamelloUrl, setEditTuiamelloUrl] = React.useState('');
  const [editExpediaUrl, setEditExpediaUrl] = React.useState('');
  const [editBusy, setEditBusy] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);

  // Load hotels
  const loadHotels = React.useCallback(async () => {
    try {
      const data = await fetchJSON('/api/hotels', { cache: 'no-store' });
      setHotels(Array.isArray(data) ? data : []);
    } catch (e:any) {
      setHError(e.message || 'Failed to load hotels');
    }
  }, []);

  React.useEffect(() => { loadHotels(); }, [loadHotels]);

  // Auto-clear success message after timeout
  React.useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(null), SUCCESS_MESSAGE_TIMEOUT_MS);
      return () => clearTimeout(timer);
    }
  }, [successMsg]);

  // Add hotel
  const onAddHotel = async (e: React.FormEvent) => {
    e.preventDefault();
    setHError(null);
    setSuccessMsg(null);
    if (!hName.trim() || !hCode.trim()) { setHError('Name and Code are required'); return; }
    
    // Validate URLs
    if (hBookingUrl && !isValidUrl(hBookingUrl)) { setHError('Invalid Booking.com URL'); return; }
    if (hTuiamelloUrl && !isValidUrl(hTuiamelloUrl)) { setHError('Invalid TUIAmello URL'); return; }
    if (hExpediaUrl && !isValidUrl(hExpediaUrl)) { setHError('Invalid Expedia URL'); return; }
    
    setHBusy(true);
    try {
      const next = await fetchJSON('/api/hotels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: hName.trim(),
          code: hCode.trim(),
          brand: hBrand.trim() || null,
          region: hRegion.trim() || null,
          country: hCountry.trim() || null,
          booking_url: hBookingUrl.trim() || null,
          tuiamello_url: hTuiamelloUrl.trim() || null,
          expedia_url: hExpediaUrl.trim() || null,
        }),
      });
      setHotels(Array.isArray(next) ? next : hotels);
      setHName(''); setHCode(''); setHBrand(''); setHRegion(''); setHCountry('');
      setHBookingUrl(''); setHTuiamelloUrl(''); setHExpediaUrl('');
      setSuccessMsg('Hotel added successfully!');
    } catch (e:any) {
      setHError(e.message || 'Saving failed');
    } finally { setHBusy(false); }
  };

  // Start editing
  const startEdit = (hotel: Hotel) => {
    setEditingId(hotel.id);
    setEditBrand(hotel.brand || '');
    setEditRegion(hotel.region || '');
    setEditCountry(hotel.country || '');
    setEditBookingUrl(hotel.booking_url || '');
    setEditTuiamelloUrl(hotel.tuiamello_url || '');
    setEditExpediaUrl(hotel.expedia_url || '');
    setEditError(null);
    setSuccessMsg(null);
  };

  // Cancel editing
  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  // Save edited hotel
  const saveEdit = async (hotelId: number) => {
    setEditError(null);
    setSuccessMsg(null);
    
    // Validate URLs
    if (editBookingUrl && !isValidUrl(editBookingUrl)) { setEditError('Invalid Booking.com URL'); return; }
    if (editTuiamelloUrl && !isValidUrl(editTuiamelloUrl)) { setEditError('Invalid TUIAmello URL'); return; }
    if (editExpediaUrl && !isValidUrl(editExpediaUrl)) { setEditError('Invalid Expedia URL'); return; }
    
    setEditBusy(true);
    try {
      const updated = await fetchJSON(`/api/hotels/${hotelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: editBrand.trim() || null,
          region: editRegion.trim() || null,
          country: editCountry.trim() || null,
          booking_url: editBookingUrl.trim() || null,
          tuiamello_url: editTuiamelloUrl.trim() || null,
          expedia_url: editExpediaUrl.trim() || null,
        }),
      });
      
      // Update the hotel in the list
      setHotels(prev => prev.map(h => h.id === hotelId ? updated : h));
      setEditingId(null);
      setSuccessMsg('Hotel updated successfully!');
    } catch (e:any) {
      setEditError(e.message || 'Update failed');
    } finally { setEditBusy(false); }
  };

  return (
    <main>
      {/* Success message */}
      {successMsg && (
        <div className="alert alert-success alert-dismissible fade show" role="alert">
          <i className="fa fa-check-circle me-2"></i>{successMsg}
          <button type="button" className="btn-close" onClick={() => setSuccessMsg(null)}></button>
        </div>
      )}

      <div className="card mb-3">
        <div className="card-header">Add Hotel</div>
        <div className="card-body">
          <form onSubmit={onAddHotel}>
            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label">Name <span className="text-danger">*</span></label>
                <input className="form-control" value={hName} onChange={e => setHName(e.target.value)} placeholder="Hotel Alpha" />
              </div>
              <div className="col-md-4">
                <label className="form-label">Code <span className="text-danger">*</span></label>
                <input className="form-control" value={hCode} onChange={e => setHCode(e.target.value)} placeholder="ALPHA123" />
              </div>
              <div className="col-md-4">
                <label className="form-label">Brand</label>
                <input className="form-control" value={hBrand} onChange={e => setHBrand(e.target.value)} placeholder="e.g., Amello" />
              </div>
            </div>
            <div className="row g-3 mt-2">
              <div className="col-md-4">
                <label className="form-label">Region</label>
                <input className="form-control" value={hRegion} onChange={e => setHRegion(e.target.value)} placeholder="e.g., Algarve" />
              </div>
              <div className="col-md-4">
                <label className="form-label">Country</label>
                <input className="form-control" value={hCountry} onChange={e => setHCountry(e.target.value)} placeholder="e.g., Portugal" />
              </div>
            </div>
            <div className="row g-3 mt-2">
              <div className="col-md-4">
                <label className="form-label">Booking.com URL</label>
                <input type="url" className="form-control" value={hBookingUrl} onChange={e => setHBookingUrl(e.target.value)} placeholder="https://www.booking.com/..." />
              </div>
              <div className="col-md-4">
                <label className="form-label">TUIAmello URL</label>
                <input type="url" className="form-control" value={hTuiamelloUrl} onChange={e => setHTuiamelloUrl(e.target.value)} placeholder="https://www.tuiamello.com/..." />
              </div>
              <div className="col-md-4">
                <label className="form-label">Expedia URL</label>
                <input type="url" className="form-control" value={hExpediaUrl} onChange={e => setHExpediaUrl(e.target.value)} placeholder="https://www.expedia.com/..." />
              </div>
            </div>
            <div className="row mt-3">
              <div className="col-md-12">
                <button className="btn btn-primary" disabled={hBusy}>{hBusy ? 'Saving…' : 'Add hotel'}</button>
              </div>
            </div>
            {hError ? <div className="mt-3 text-danger small">{hError}</div> : null}
          </form>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Current Hotels</div>
        <div className="card-body">
          {hotels.length === 0 ? <p className="text-muted mb-0">No hotels yet.</p> : (
            <div className="table-responsive">
              <table className="table table-sm align-middle">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>Name</th>
                    <th>Code</th>
                    <th>Brand</th>
                    <th>Region</th>
                    <th>Country</th>
                    <th>Booking.com</th>
                    <th>TUIAmello</th>
                    <th>Expedia</th>
                    <th style={{ width: 120 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {hotels.map((h,i) => {
                    const isEditing = editingId === h.id;
                    return (
                      <tr key={h.id} className={isEditing ? 'table-active' : ''}>
                        <td>{i+1}</td>
                        <td>{h.name}</td>
                        <td><code>{h.code}</code></td>
                        <td>
                          {isEditing ? (
                            <input 
                              className="form-control form-control-sm" 
                              value={editBrand} 
                              onChange={e => setEditBrand(e.target.value)} 
                              disabled={editBusy}
                            />
                          ) : (h.brand || '')}
                        </td>
                        <td>
                          {isEditing ? (
                            <input 
                              className="form-control form-control-sm" 
                              value={editRegion} 
                              onChange={e => setEditRegion(e.target.value)} 
                              disabled={editBusy}
                            />
                          ) : (h.region || '')}
                        </td>
                        <td>
                          {isEditing ? (
                            <input 
                              className="form-control form-control-sm" 
                              value={editCountry} 
                              onChange={e => setEditCountry(e.target.value)} 
                              disabled={editBusy}
                            />
                          ) : (h.country || '')}
                        </td>
                        <td>
                          {isEditing ? (
                            <input 
                              type="url"
                              className="form-control form-control-sm" 
                              value={editBookingUrl} 
                              onChange={e => setEditBookingUrl(e.target.value)} 
                              disabled={editBusy}
                              placeholder="URL"
                            />
                          ) : (
                            h.booking_url ? (
                              <a href={h.booking_url} target="_blank" rel="noopener noreferrer" className="text-decoration-none">
                                <i className="fa fa-external-link"></i> Link
                              </a>
                            ) : (
                              <span className="text-muted">—</span>
                            )
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <input 
                              type="url"
                              className="form-control form-control-sm" 
                              value={editTuiamelloUrl} 
                              onChange={e => setEditTuiamelloUrl(e.target.value)} 
                              disabled={editBusy}
                              placeholder="URL"
                            />
                          ) : (
                            h.tuiamello_url ? (
                              <a href={h.tuiamello_url} target="_blank" rel="noopener noreferrer" className="text-decoration-none">
                                <i className="fa fa-external-link"></i> Link
                              </a>
                            ) : (
                              <span className="text-muted">—</span>
                            )
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <input 
                              type="url"
                              className="form-control form-control-sm" 
                              value={editExpediaUrl} 
                              onChange={e => setEditExpediaUrl(e.target.value)} 
                              disabled={editBusy}
                              placeholder="URL"
                            />
                          ) : (
                            h.expedia_url ? (
                              <a href={h.expedia_url} target="_blank" rel="noopener noreferrer" className="text-decoration-none">
                                <i className="fa fa-external-link"></i> Link
                              </a>
                            ) : (
                              <span className="text-muted">—</span>
                            )
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <div className="btn-group btn-group-sm" role="group">
                              <button 
                                className="btn btn-success" 
                                onClick={() => saveEdit(h.id)} 
                                disabled={editBusy}
                              >
                                <i className="fa fa-check"></i> Save
                              </button>
                              <button 
                                className="btn btn-secondary" 
                                onClick={cancelEdit} 
                                disabled={editBusy}
                              >
                                <i className="fa fa-times"></i> Cancel
                              </button>
                            </div>
                          ) : (
                            <button 
                              className="btn btn-sm btn-primary" 
                              onClick={() => startEdit(h)}
                              disabled={editingId !== null}
                            >
                              <i className="fa fa-edit"></i> Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {editError && (
                <div className="alert alert-danger mt-2 mb-0" role="alert">
                  {editError}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
