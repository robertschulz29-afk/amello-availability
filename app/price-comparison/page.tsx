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
  status: 'queued'|'running'|'done'|'error';
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

type GroupedData = {
  [hotelId: number]: {
    hotelName: string;
    dates: {
      [date: string]: ComparisonRow[];
    };
  };
};

function fmtDateTime(dt: string) {
  try { return new Date(dt).toLocaleString(); } catch { return dt; }
}

function addDays(ymd: string, n: number): string {
  const [y,m,d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth()+1).padStart(2,'0');
  const dd = String(dt.getUTCDate()).padStart(2,'0');
  return `${yy}-${mm}-${dd}`;
}

function todayYMD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

function getHotelDisplay(name: string | null | undefined, code: string | null | undefined): string {
  if (name && code) return `${name} (${code})`;
  if (name) return name;
  return code || 'Unknown';
}

export default function Page() {
  // Scans list for the dropdown
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);

  // Hotels list for the dropdown
  const [hotels, setHotels] = React.useState<HotelRow[]>([]);
  const [selectedHotelId, setSelectedHotelId] = React.useState<number | null>(null);
  const [hotelSearchTerm, setHotelSearchTerm] = React.useState<string>('');

  // Scan details
  const [scanDetails, setScanDetails] = React.useState<{
    scanId: number;
    scannedAt: string;
    baseCheckIn: string | null;
    days: number | null;
    stayNights: number | null;
    timezone: string | null;
  } | null>(null);

  // Results
  const [results, setResults] = React.useState<ComparisonRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Load scans list for dropdown
  const loadScans = React.useCallback(async () => {
    try {
      const list = await fetchJSON('/api/scans', { cache: 'no-store' });
      const arr: ScanRow[] = Array.isArray(list) ? list : [];
      arr.sort((a,b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());
      setScans(arr);
      if (arr.length > 0 && selectedScanId == null) {
        setSelectedScanId(arr[0].id);
      }
    } catch (e:any) {
      setError(e.message || 'Failed to load scans');
    }
  }, [selectedScanId]);

  // Load hotels list for dropdown
  const loadHotels = React.useCallback(async () => {
    try {
      const list = await fetchJSON('/api/hotels', { cache: 'no-store' });
      const arr: HotelRow[] = Array.isArray(list) ? list : [];
      arr.sort((a,b) => a.name.localeCompare(b.name));
      setHotels(arr);
    } catch (e:any) {
      console.error('Failed to load hotels', e);
    }
  }, []);

  // Load scan details
  const loadScanDetails = React.useCallback(async (scanId: number) => {
    try {
      const data = await fetchJSON(`/api/scans/${scanId}`, { cache: 'no-store' });
      setScanDetails({
        scanId,
        scannedAt: String(data?.scannedAt ?? ''),
        baseCheckIn: data?.baseCheckIn ?? null,
        days: data?.days ?? null,
        stayNights: data?.stayNights ?? null,
        timezone: data?.timezone ?? null,
      });
    } catch (e:any) {
      console.error('Failed to load scan details', e);
      setScanDetails(null);
    }
  }, []);

  // Load comparison results
  const loadResults = React.useCallback(async () => {
    if (selectedScanId == null) {
      setResults([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        scanID: selectedScanId.toString(),
        format: 'comparison',
        limit: '1000', // Load all results for grouping
      });

      // Add optional filters
      if (selectedHotelId) {
        params.append('hotelID', selectedHotelId.toString());
      }

      const url = `/api/scan-results?${params.toString()}`;
      const data: PaginatedResponse = await fetchJSON(url, { cache: 'no-store' });
      setResults(data.data || []);
    } catch (e:any) {
      setError(e.message || 'Failed to load results');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [selectedScanId, selectedHotelId]);

  React.useEffect(() => { loadScans(); }, [loadScans]);
  React.useEffect(() => { loadHotels(); }, [loadHotels]);
  React.useEffect(() => { 
    if (selectedScanId != null) {
      loadScanDetails(selectedScanId);
      loadResults();
    }
  }, [selectedScanId, loadScanDetails, loadResults]);

  // Filter hotels based on search term
  const filteredHotels = React.useMemo(() => {
    if (!hotelSearchTerm.trim()) return hotels;
    const term = hotelSearchTerm.toLowerCase();
    return hotels.filter(h => 
      h.name.toLowerCase().includes(term) || 
      h.code.toLowerCase().includes(term) ||
      h.id.toString().includes(term)
    );
  }, [hotels, hotelSearchTerm]);

  // Group results by hotel -> date -> room -> rate
  const groupedData = React.useMemo(() => {
    const grouped: GroupedData = {};

    for (const row of results) {
      if (!grouped[row.hotel_id]) {
        grouped[row.hotel_id] = {
          hotelName: row.hotel_name,
          dates: {},
        };
      }

      if (!grouped[row.hotel_id].dates[row.check_in_date]) {
        grouped[row.hotel_id].dates[row.check_in_date] = [];
      }

      grouped[row.hotel_id].dates[row.check_in_date].push(row);
    }

    return grouped;
  }, [results]);

  // Calculate price difference
  const calculateDifference = (amelloPrice: number | null, bookingPrice: number | null) => {
    if (amelloPrice == null || bookingPrice == null) return null;
    // Allow zero as valid price, but return null if both are zero (no meaningful difference)
    if (bookingPrice === 0 && amelloPrice === 0) return null;
    // If booking price is zero but amello is not, show the full difference
    if (bookingPrice === 0) {
      return { diff: amelloPrice, pct: 0 };
    }
    const diff = amelloPrice - bookingPrice;
    const pct = (diff / bookingPrice) * 100;
    return { diff, pct };
  };

  // Get status badge class
  const getStatusBadgeClass = (statusAmello: string | null, statusBooking: string | null) => {
    if (statusAmello === 'green' && statusBooking === 'green') return 'bg-success';
    if (statusAmello === 'green' || statusBooking === 'green') return 'bg-warning';
    return 'bg-danger';
  };

  return (
    <main>
      <h1 className="h3 mb-3">Price Comparison</h1>

      {/* Scan selector */}
      <div className="d-flex flex-wrap gap-3 align-items-center mb-3">
        <div className="d-flex align-items-center gap-2">
          <label className="form-label mb-0">Scan ID:</label>
          <select 
            className="form-select" 
            style={{ minWidth: 300 }} 
            value={selectedScanId ?? ''} 
            onChange={e => {
              setSelectedScanId(Number(e.target.value));
            }}
          >
            {scans.length === 0 ? (
              <option value="">No scans</option>
            ) : (
              scans.map(s => (
                <option key={s.id} value={s.id}>
                  #{s.id} • {fmtDateTime(s.scanned_at)} • {s.status} ({s.done_cells}/{s.total_cells})
                </option>
              ))
            )}
          </select>
        </div>

        <div className="d-flex align-items-center gap-2">
          <label className="form-label mb-0">Hotel:</label>
          <div className="d-flex flex-column gap-1">
            <input 
              type="text" 
              className="form-control form-control-sm" 
              style={{ minWidth: 250 }}
              placeholder="Search hotels by name or code..." 
              value={hotelSearchTerm} 
              onChange={e => setHotelSearchTerm(e.target.value)}
            />
            <select 
              className="form-select form-select-sm" 
              style={{ minWidth: 250 }} 
              value={selectedHotelId ?? ''} 
              onChange={e => {
                setSelectedHotelId(e.target.value ? Number(e.target.value) : null);
              }}
            >
              <option value="">All Hotels</option>
              {filteredHotels.map(h => (
                <option key={h.id} value={h.id}>
                  {getHotelDisplay(h.name, h.code)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Scan details card */}
      {scanDetails && (
        <div className="card mb-3">
          <div className="card-header">Scan Parameters</div>
          <div className="card-body small">
            <div className="row g-2">
              <div className="col-sm-6 col-md-4"><strong>Scan ID:</strong> {scanDetails.scanId}</div>
              <div className="col-sm-6 col-md-4"><strong>Scanned at:</strong> {fmtDateTime(scanDetails.scannedAt)}</div>
              <div className="col-sm-6 col-md-4"><strong>Timezone:</strong> {scanDetails.timezone ?? '—'}</div>
              <div className="col-sm-6 col-md-4"><strong>Base check-in:</strong> {scanDetails.baseCheckIn ?? '—'}</div>
              <div className="col-sm-6 col-md-4"><strong>Days scanned:</strong> {scanDetails.days ?? '—'}</div>
              <div className="col-sm-6 col-md-4"><strong>Stay (nights):</strong> {scanDetails.stayNights ?? '—'}</div>
            </div>
          </div>
        </div>
      )}

      {error && <div className="alert alert-danger">{error}</div>}

      {/* Results */}
      {loading ? (
        <div className="text-center py-4">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      ) : results.length > 0 ? (
        <>
          {Object.entries(groupedData).map(([hotelId, hotelData]) => (
            <div key={hotelId} className="mb-4">  
              <h4>{hotelData.hotelName}</h4>
              <div key={date} className="mb-3">
                  <div className="table-responsive border rounded">
                    <table className="table table-sm table-striped mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>Hotel</th>
                          <th>Check-In</th>
                          <th>Room Name</th>
                          <th>Rate Name</th>
                          <th className="text-end">Price (Amello)</th>
                          <th className="text-end">Price (Booking.com)</th>
                          <th className="text-end">Difference</th>
                          <th className="text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                      {Object.entries(hotelData.dates).sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => (
                
                        {rows.map((row, idx) => {
                          const diff = calculateDifference(row.price_amello, row.price_booking);
                          const statusClass = getStatusBadgeClass(row.status_amello, row.status_booking);
                          
                          return (
                            <tr key={idx}>
                              <td>{hotelData.hotelName}</td>
                              <td>{date}</td>
                              <td>{row.room_name || '—'}</td>
                              <td>{row.rate_name || '—'}</td>
                              <td className="text-end">
                                {row.price_amello != null ? (
                                  <span className={row.status_amello === 'green' ? 'text-success' : 'text-danger'}>
                                    {formatPrice(row.price_amello, row.currency)}
                                  </span>
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </td>
                              <td className="text-end">
                                {row.price_booking != null ? (
                                  <span className={row.status_booking === 'green' ? 'text-success' : 'text-danger'}>
                                    {formatPrice(row.price_booking, row.currency)}
                                  </span>
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </td>
                              <td className="text-end">
                                {diff != null ? (
                                  <span className={diff.diff < 0 ? 'text-success' : diff.diff > 0 ? 'text-danger' : ''}>
                                    {diff.diff < 0 ? '' : '+'}{formatPrice(diff.diff, row.currency)} ({diff.pct > 0 ? '+' : ''}{diff.pct.toFixed(1)}%)
                                  </span>
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </td>
                              <td className="text-center">
                                <span className={`badge ${statusClass}`}>
                                  {row.status_amello === 'green' && row.status_booking === 'green' ? 'Both' : 
                                   row.status_amello === 'green' ? 'Amello Only' :
                                   row.status_booking === 'green' ? 'Booking Only' : 'None'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                     
              ))}
                         </tbody>
                    </table>
                  </div>
                </div>
            </div>
          ))}
        </>
      ) : (
        <p className="text-muted">No results found{selectedScanId ? ' for this scan' : ''}.</p>
      )}
    </main>
  );
}
