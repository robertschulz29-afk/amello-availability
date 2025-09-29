'use client';
import { useEffect, useMemo, useState } from 'react';

type Hotel = { id: number; name: string; code: string };
type Cells = Record<string, Record<string, 'green' | 'red'>>;
type Scan = { id: number; scanned_at: string };

export default function Page() {
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [cells, setCells] = useState<Cells>({});
  const [loading, setLoading] = useState(false);
  const [scans, setScans] = useState<Scan[]>([]);
  const [selectedScanId, setSelectedScanId] = useState<number | ''>('');
  const [displayedAt, setDisplayedAt] = useState<string | null>(null);

  async function fetchHotels() {
    const r = await fetch('/api/hotels', { cache: 'no-store' });
    setHotels(await r.json());
  }
  async function fetchScans() {
    const r = await fetch('/api/scans', { cache: 'no-store' });
    const list = await r.json();
    setScans(list);
    if (!selectedScanId && list.length) {
      setSelectedScanId(list[0].id);
      await loadScan(list[0].id);
    }
  }

  useEffect(() => {
    fetchHotels();
    fetchScans();
  }, []);

  async function loadScan(id: number) {
    setLoading(true);
    try {
      const r = await fetch(`/api/scans/${id}`);
      const j = await r.json();
      setDates(j.dates);
      setCells(j.results);
      setDisplayedAt(j.scannedAt);
      setSelectedScanId(id);
    } finally {
      setLoading(false);
    }
  }

  async function createScan() {
    setLoading(true);
    try {
      const r = await fetch('/api/scans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const j = await r.json();
      setDates(j.dates);
      setCells(j.results);
      setDisplayedAt(j.scannedAt);
      await fetchScans();
      setSelectedScanId(j.scanId);
    } finally {
      setLoading(false);
    }
  }

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  async function addHotel() {
    if (!name || !code) return;
    const r = await fetch('/api/hotels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, code }) });
    setHotels(await r.json());
    setName(''); setCode('');
  }
  async function removeHotel(c: string) {
    const r = await fetch('/api/hotels', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: c }) });
    setHotels(await r.json());
  }

  const displayedScanLabel = useMemo(() => {
    if (!displayedAt) return '—';
    const d = new Date(displayedAt);
    return d.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    }, [displayedAt]);

  return (
    <div style={{ padding: 24, display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600 }}>Hotel Availability Matrix</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label style={{ fontSize: 14 }}>Scan:</label>
          <select value={selectedScanId} onChange={(e) => { const v = Number(e.target.value); if (v) loadScan(v); }}>
            <option value="">(none)</option>
            {scans.map(s => (
              <option key={s.id} value={s.id}>
                {new Date(s.scanned_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} (#{s.id})
              </option>
            ))}
          </select>
          <button onClick={createScan} disabled={loading || hotels.length === 0} style={{ padding: '8px 12px' }}>
            {loading ? 'Updating…' : 'New scan'}
          </button>
          <span style={{ color: '#666' }}>Displayed scan (check-in grid): {displayedScanLabel}</span>
        </div>
      </header>

      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Manage Hotels</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input placeholder="Hotel name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Hotel code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button onClick={addHotel}>Add</button>
        </div>
        <ul style={{ fontSize: 14 }}>
          {hotels.map(h => (
            <li key={h.code} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0' }}>
              <span style={{ width: 260 }}>{h.name}</span>
              <span style={{ width: 180, color: '#666' }}>{h.code}</span>
              <button onClick={() => removeHotel(h.code)} style={{ color: '#b00020' }}>Remove</button>
            </li>
          ))}
          {hotels.length === 0 && <li style={{ color: '#666' }}>Add hotels to begin.</li>}
        </ul>
      </section>

      <section style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
          <thead>
            <tr>
              <th style={{ border: '1px solid #ddd', padding: 8, background: '#f7f7f7', position: 'sticky', left: 0, zIndex: 1 }}>Hotel</th>
              {dates.map((d) => (
                <th key={d} style={{ border: '1px solid #ddd', padding: 8, background: '#f7f7f7', whiteSpace: 'nowrap' }}>{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hotels.map((h) => (
              <tr key={h.code}>
                <td style={{ border: '1px solid #ddd', padding: 8, background: '#fff', position: 'sticky', left: 0 }}>
                  {h.name} <span style={{ color: '#777', fontSize: 12 }}>({h.code})</span>
                </td>
                {dates.map((d) => {
                  const state = cells[h.code]?.[d] || 'red';
                  const bg = state === 'green' ? '#22c55e' : '#ef4444';
                  return (
                    <td key={d} style={{ border: '1px solid #eee', padding: 8, textAlign: 'center' }}>
                      <span title={state} style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 4, background: bg }} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
