// app/hotels/page.tsx
'use client';

import * as React from 'react';

type Hotel = { id: number; name: string; code: string; brand?: string; region?: string; country?: string };

async function fetchJSON(input: RequestInfo, init?: RequestInit) {
  const r = await fetch(input, init);
  const text = await r.text();
  if (!r.ok) {
    try { const j = JSON.parse(text); throw new Error(j.error || r.statusText); }
    catch { throw new Error(text || r.statusText); }
  }
  return text ? JSON.parse(text) : null;
}

export default function Page() {
  const [hotels, setHotels] = React.useState<Hotel[]>([]);
  const [hName, setHName] = React.useState('');
  const [hCode, setHCode] = React.useState('');
  const [hBrand, setHBrand] = React.useState('');
  const [hRegion, setHRegion] = React.useState('');
  const [hCountry, setHCountry] = React.useState('');
  const [hError, setHError] = React.useState<string | null>(null);
  const [hBusy, setHBusy] = React.useState(false);

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

  // Add hotel
  const onAddHotel = async (e: React.FormEvent) => {
    e.preventDefault();
    setHError(null);
    if (!hName.trim() || !hCode.trim()) { setHError('Name and Code are required'); return; }
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
          country: hCountry.trim() || null
        }),
      });
      setHotels(Array.isArray(next) ? next : hotels);
      setHName(''); setHCode(''); setHBrand(''); setHRegion(''); setHCountry('');
    } catch (e:any) {
      setHError(e.message || 'Saving failed');
    } finally { setHBusy(false); }
  };

  return (
    <main>
    

      <div className="row g-3">
        <div className="col-lg-5">
          <div className="card">
            <div className="card-header">Add Hotel</div>
            <div className="card-body">
              <form onSubmit={onAddHotel} className="row g-3">
                <div className="col-12">
                  <label className="form-label">Name</label>
                  <input className="form-control" value={hName} onChange={e => setHName(e.target.value)} placeholder="Hotel Alpha" />
                </div>
                <div className="col-12">
                  <label className="form-label">Code</label>
                  <input className="form-control" value={hCode} onChange={e => setHCode(e.target.value)} placeholder="ALPHA123" />
                </div>
                <div className="col-12">
                  <label className="form-label">Brand</label>
                  <input className="form-control" value={hBrand} onChange={e => setHBrand(e.target.value)} placeholder="e.g., Amello" />
                </div>
                <div className="col-12">
                  <label className="form-label">Region</label>
                  <input className="form-control" value={hRegion} onChange={e => setHRegion(e.target.value)} placeholder="e.g., Algarve" />
                </div>
                <div className="col-12">
                  <label className="form-label">Country</label>
                  <input className="form-control" value={hCountry} onChange={e => setHCountry(e.target.value)} placeholder="e.g., Portugal" />
                </div>

                {hError ? <div className="col-12 text-danger small">{hError}</div> : null}
                <div className="col-12">
                  <button className="btn btn-primary" disabled={hBusy}>{hBusy ? 'Saving…' : 'Add hotel'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>

        <div className="col-lg-7">
          <div className="card">
            <div className="card-header">Current Hotels</div>
            <div className="card-body">
              {hotels.length === 0 ? <p className="text-muted mb-0">No hotels yet.</p> : (
                <div className="table-responsive">
                  <table className="table table-sm align-middle">
                    <thead>
                      <tr>
                        <th style={{ width: 60 }}>#</th>
                        <th>Name</th>
                        <th>Code</th>
                        <th>Brand</th>
                        <th>Region</th>
                        <th>Country</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hotels.map((h,i) => (
                        <tr key={h.id}>
                          <td>{i+1}</td>
                          <td>{h.name}</td>
                          <td><code>{h.code}</code></td>
                          <td>{h.brand || ''}</td>
                          <td>{h.region || ''}</td>
                          <td>{h.country || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
