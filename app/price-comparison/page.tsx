// app/price-comparison/page.tsx
'use client';

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';
import { formatPrice } from '@/lib/price-utils';

type ScanRow = {
  id: number;
  scanned_at: string;
  stay_nights: number;
  total_cells: number;
  done_cells: number;
  status: 'queued' | 'running' | 'done' | 'error';
};

type HotelRow = {
  id: number;
  name: string;
  code: string;
};

type ComparisonRow = {
  hotel_id: number;
  hotel_name: string;
  check_in_date: string;
  room_name: string;
  rate_name: string;
  price_amello: number | null;
  price_booking: number | null;
  status_amello: 'green' | 'red' | null;
  status_booking: 'green' | 'red' | null;
  currency: string;
};

type PaginatedResponse = {
  data: ComparisonRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

function fmtDateTime(dt: string) {
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt;
  }
}

function getHotelDisplay(
  name: string | null | undefined,
  code: string | null | undefined
) {
  if (name && code) return `${name} (${code})`;
  if (name) return name;
  return code || 'Unknown';
}

export default function Page() {
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);

  const [hotels, setHotels] = React.useState<HotelRow[]>([]);
  const [selectedHotelId, setSelectedHotelId] = React.useState<number | null>(null);
  const [hotelSearchTerm, setHotelSearchTerm] = React.useState('');

  const [scanDetails, setScanDetails] = React.useState<{
    scanId: number;
    scannedAt: string;
    baseCheckIn: string | null;
    days: number | null;
    stayNights: number | null;
    timezone: string | null;
  } | null>(null);

  const [results, setResults] = React.useState<ComparisonRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const loadScans = React.useCallback(async () => {
    const list = await fetchJSON('/api/scans', { cache: 'no-store' });
    const arr: ScanRow[] = Array.isArray(list) ? list : [];
    arr.sort(
      (a, b) =>
        new Date(b.scanned_at).getTime() -
        new Date(a.scanned_at).getTime()
    );
    setScans(arr);
    if (!selectedScanId && arr.length > 0) {
      setSelectedScanId(arr[0].id);
    }
  }, [selectedScanId]);

  const loadHotels = React.useCallback(async () => {
    const list = await fetchJSON('/api/hotels', { cache: 'no-store' });
    const arr: HotelRow[] = Array.isArray(list) ? list : [];
    arr.sort((a, b) => a.name.localeCompare(b.name));
    setHotels(arr);
  }, []);

  const loadScanDetails = React.useCallback(async (scanId: number) => {
    const data = await fetchJSON(`/api/scans/${scanId}`, { cache: 'no-store' });
    setScanDetails({
      scanId,
      scannedAt: String(data?.scannedAt ?? ''),
      baseCheckIn: data?.baseCheckIn ?? null,
      days: data?.days ?? null,
      stayNights: data?.stayNights ?? null,
      timezone: data?.timezone ?? null,
    });
  }, []);

  const loadResults = React.useCallback(async () => {
    if (!selectedScanId) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        scanID: selectedScanId.toString(),
        format: 'comparison',
        limit: '1000',
      });

      if (selectedHotelId) {
        params.append('hotelID', selectedHotelId.toString());
      }

      const res: PaginatedResponse = await fetchJSON(
        `/api/scan-results?${params}`,
        { cache: 'no-store' }
      );

      setResults(res.data || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load results');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [selectedScanId, selectedHotelId]);

  React.useEffect(() => { loadScans(); }, [loadScans]);
  React.useEffect(() => { loadHotels(); }, [loadHotels]);
  React.useEffect(() => {
    if (selectedScanId) {
      loadScanDetails(selectedScanId);
      loadResults();
    }
  }, [selectedScanId, loadScanDetails, loadResults]);

  const filteredHotels = React.useMemo(() => {
    if (!hotelSearchTerm.trim()) return hotels;
    const term = hotelSearchTerm.toLowerCase();
    return hotels.filter(h =>
      h.name.toLowerCase().includes(term) ||
      h.code.toLowerCase().includes(term)
    );
  }, [hotels, hotelSearchTerm]);

  // ✅ GROUP BY HOTEL ONLY
  const groupedData = React.useMemo(() => {
    const grouped: Record<number, ComparisonRow[]> = {};
    for (const row of results) {
      grouped[row.hotel_id] ??= [];
      grouped[row.hotel_id].push(row);
    }
    return grouped;
  }, [results]);

  const calculateDifference = (a: number | null, b: number | null) => {
    if (a == null || b == null || (a === 0 && b === 0)) return null;
    const diff = a - b;
    const pct = b !== 0 ? (diff / b) * 100 : 0;
    return { diff, pct };
  };

  const getStatusBadgeClass = (a: string | null, b: string | null) => {
    if (a === 'green' && b === 'green') return 'bg-success';
    if (a === 'green' || b === 'green') return 'bg-warning';
    return 'bg-danger';
  };

  return (
    <main>
      <h1 className="h3 mb-3">Price Comparison</h1>

      {/* Selectors */}
      <div className="d-flex gap-3 mb-3 flex-wrap">
        <select
          className="form-select"
          style={{ minWidth: 300 }}
          value={selectedScanId ?? ''}
          onChange={e => setSelectedScanId(Number(e.target.value))}
        >
          {scans.map(s => (
            <option key={s.id} value={s.id}>
              #{s.id} • {fmtDateTime(s.scanned_at)} • {s.status}
            </option>
          ))}
        </select>

        <input
          className="form-control"
          placeholder="Search hotels..."
          value={hotelSearchTerm}
          onChange={e => setHotelSearchTerm(e.target.value)}
        />

        <select
          className="form-select"
          value={selectedHotelId ?? ''}
          onChange={e =>
            setSelectedHotelId(e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">All Hotels</option>
          {filteredHotels.map(h => (
            <option key={h.id} value={h.id}>
              {getHotelDisplay(h.name, h.code)}
            </option>
          ))}
        </select>
      </div>

      {/* Scan parameters */}
      {scanDetails && (
        <div className="card mb-3">
          <div className="card-header">Scan Parameters</div>
          <div className="card-body small row g-2">
            <div className="col-md-4"><strong>Scan ID:</strong> {scanDetails.scanId}</div>
            <div className="col-md-4"><strong>Scanned at:</strong> {fmtDateTime(scanDetails.scannedAt)}</div>
            <div className="col-md-4"><strong>Timezone:</strong> {scanDetails.timezone}</div>
            <div className="col-md-4"><strong>Base check-in:</strong> {scanDetails.baseCheckIn}</div>
            <div className="col-md-4"><strong>Days scanned:</strong> {scanDetails.days}</div>
            <div className="col-md-4"><strong>Stay nights:</strong> {scanDetails.stayNights}</div>
          </div>
        </div>
      )}

      {error && <div className="alert alert-danger">{error}</div>}

      {Object.entries(groupedData).map(([hotelId, rows]) => (
        <div key={hotelId} className="mb-4">
          <h4>{rows[0].hotel_name}</h4>

          <div className="table-responsive border rounded">
            <table className="table table-sm table-striped mb-0">
              <thead className="table-light">
                <tr>
                  <th>Hotel</th>
                  <th>Check-In</th>
                  <th>Room</th>
                  <th>Rate</th>
                  <th className="text-end">Amello</th>
                  <th className="text-end">Booking</th>
                  <th className="text-end">Diff</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date))
                  .map((r, i) => {
                    const diff = calculateDifference(r.price_amello, r.price_booking);
                    return (
                      <tr key={i}>
                        <td>{r.hotel_name}</td>
                        <td>{r.check_in_date}</td>
                        <td>{r.room_name || '—'}</td>
                        <td>{r.rate_name || '—'}</td>
                        <td className="text-end">{r.price_amello != null ? formatPrice(r.price_amello, r.currency) : '—'}</td>
                        <td className="text-end">{r.price_booking != null ? formatPrice(r.price_booking, r.currency) : '—'}</td>
                        <td className="text-end">
                          {diff ? `${diff.diff > 0 ? '+' : ''}${formatPrice(diff.diff, r.currency)}` : '—'}
                        </td>
                        <td>
                          <span className={`badge ${getStatusBadgeClass(r.status_amello, r.status_booking)}`}>
                            {r.status_amello === 'green' && r.status_booking === 'green'
                              ? 'Both'
                              : r.status_amello === 'green'
                              ? 'Amello'
                              : r.status_booking === 'green'
                              ? 'Booking'
                              : 'None'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </main>
  );
}
