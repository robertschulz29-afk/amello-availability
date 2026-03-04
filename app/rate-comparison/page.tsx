// app/rate-comparison/page.tsx
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

type RateComparisonRow = {
  scan_id: number;
  hotel_id: number;
  hotel_name: string;
  check_in_date: string;
  amello_min_price: number | null;
  amello_currency: string | null;
  amello_room_name: string | null;
  amello_rate_name: string | null;
  booking_min_price: number | null;
  booking_currency: string | null;
  booking_room_name: string | null;
  booking_rate_name: string | null;
  price_difference: number | null;
  percentage_difference: number | null;
};

type PaginatedResponse = {
  data: RateComparisonRow[];
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

function fmtDate(dt: string) {
  try {
    return new Date(dt).toLocaleDateString();
  } catch {
    return dt;
  }
}

function getHotelDisplay(name: string | null | undefined, code: string | null | undefined) {
  if (name && code) return `${name} (${code})`;
  return name || code || 'Unknown';
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

  const [comparisonData, setComparisonData] = React.useState<RateComparisonRow[]>([]);
  const [pagination, setPagination] = React.useState({ page: 1, limit: 100, total: 0, totalPages: 0 });
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const loadScans = React.useCallback(async () => {
    const list = await fetchJSON('/api/scans', { cache: 'no-store' });
    const arr: ScanRow[] = Array.isArray(list) ? list : [];
    arr.sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());
    setScans(arr);
    if (!selectedScanId && arr.length > 0) setSelectedScanId(arr[0].id);
  }, [selectedScanId]);

  const loadHotels = React.useCallback(async () => {
    const list = await fetchJSON('/api/hotels', { cache: 'no-store' });
    const arr: HotelRow[] = Array.isArray(list) ? list : [];
    arr.sort((a, b) => a.name.localeCompare(b.name));
    setHotels(arr);
  }, []);

  const loadScanDetails = React.useCallback(async (scanId: number) => {
    try {
      const details = await fetchJSON(`/api/scans/${scanId}`, { cache: 'no-store' });
      setScanDetails({
        scanId: details.id,
        scannedAt: details.scanned_at,
        baseCheckIn: details.base_checkin,
        days: details.days,
        stayNights: details.stay_nights,
        timezone: details.timezone,
      });
    } catch (err: any) {
      console.error('Failed to load scan details:', err);
      setScanDetails(null);
    }
  }, []);

  const loadComparisonData = React.useCallback(async (scanId: number, hotelId: number | null, page: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        scanID: String(scanId),
        page: String(page),
        limit: String(pagination.limit),
      });
      if (hotelId !== null) {
        params.append('hotelID', String(hotelId));
      }

      const response: PaginatedResponse = await fetchJSON(`/api/rate-comparison?${params}`, { cache: 'no-store' });
      const normalizedData = response.data.map((row) => ({
        ...row,
        amello_min_price: toNumberOrNull(row.amello_min_price),
        booking_min_price: toNumberOrNull(row.booking_min_price),
        price_difference: toNumberOrNull(row.price_difference),
        percentage_difference: toNumberOrNull(row.percentage_difference),
      }));
      setComparisonData(normalizedData);
      setPagination({
        page: response.page,
        limit: response.limit,
        total: response.total,
        totalPages: response.totalPages,
      });
    } catch (err: any) {
      console.error('Failed to load comparison data:', err);
      setError(err.message || 'Failed to load comparison data');
      setComparisonData([]);
    } finally {
      setLoading(false);
    }
  }, [pagination.limit]);

  React.useEffect(() => {
    loadScans();
    loadHotels();
  }, [loadScans, loadHotels]);

  React.useEffect(() => {
    if (selectedScanId !== null) {
      loadScanDetails(selectedScanId);
      loadComparisonData(selectedScanId, selectedHotelId, 1);
    }
  }, [selectedScanId, selectedHotelId, loadScanDetails, loadComparisonData]);

  const filteredHotels = React.useMemo(() => {
    if (!hotelSearchTerm) return hotels;
    const term = hotelSearchTerm.toLowerCase();
    return hotels.filter(
      (h) => h.name.toLowerCase().includes(term) || h.code.toLowerCase().includes(term)
    );
  }, [hotels, hotelSearchTerm]);

  const handlePageChange = (newPage: number) => {
    if (selectedScanId !== null && newPage > 0 && newPage <= pagination.totalPages) {
      loadComparisonData(selectedScanId, selectedHotelId, newPage);
    }
  };

  // Calculate summary statistics
  const summary = React.useMemo(() => {
    const stats = {
      totalComparisons: comparisonData.length,
      bothAvailable: 0,
      amelloOnly: 0,
      bookingOnly: 0,
      amelloCheaper: 0,
      bookingCheaper: 0,
      samePrice: 0,
      avgAmello: null as string | null,
      avgBooking: null as string | null,
    };

    let amelloSum = 0;
    let amelloCount = 0;
    let bookingSum = 0;
    let bookingCount = 0;
    let currency = 'EUR';

    for (const row of comparisonData) {
      if (row.amello_min_price !== null && row.booking_min_price !== null) {
        stats.bothAvailable++;
        if (row.price_difference! > 0.01) {
          stats.bookingCheaper++;
        } else if (row.price_difference! < -0.01) {
          stats.amelloCheaper++;
        } else {
          stats.samePrice++;
        }
      } else if (row.amello_min_price !== null) {
        stats.amelloOnly++;
      } else if (row.booking_min_price !== null) {
        stats.bookingOnly++;
      }

      if (row.amello_min_price !== null) {
        amelloSum += row.amello_min_price;
        amelloCount++;
        if (row.amello_currency) currency = row.amello_currency;
      }
      if (row.booking_min_price !== null) {
        bookingSum += row.booking_min_price;
        bookingCount++;
        if (row.booking_currency) currency = row.booking_currency;
      }
    }

    if (amelloCount > 0) {
      stats.avgAmello = formatPrice(amelloSum / amelloCount, currency);
    }
    if (bookingCount > 0) {
      stats.avgBooking = formatPrice(bookingSum / bookingCount, currency);
    }

    return stats;
  }, [comparisonData]);

  return (
    <main>
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h1 className="h3 mb-0">Rate Comparison</h1>
      </div>

      <div className="d-flex gap-3 mb-3 flex-wrap">
        <select
          className="form-select"
          style={{ minWidth: 300 }}
          value={selectedScanId ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            setSelectedScanId(val ? Number(val) : null);
          }}
        >
          <option value="">All Scans</option>
          {scans.map((s) => (
            <option key={s.id} value={s.id}>
              #{s.id} • {fmtDateTime(s.scanned_at)} • {s.status}
            </option>
          ))}
        </select>

        <input
          type="text"
          className="form-control"
          style={{ maxWidth: 200 }}
          placeholder="Search hotels..."
          value={hotelSearchTerm}
          onChange={(e) => setHotelSearchTerm(e.target.value)}
        />

        <select
          className="form-select"
          style={{ maxWidth: 300 }}
          value={selectedHotelId ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            setSelectedHotelId(val ? Number(val) : null);
          }}
        >
          <option value="">All Hotels</option>
          {filteredHotels.map((h) => (
            <option key={h.id} value={h.id}>
              {getHotelDisplay(h.name, h.code)}
            </option>
          ))}
        </select>
      </div>

      {scanDetails && (
        <div className="card mb-3">
          <div className="card-header">Scan Parameters</div>
          <div className="card-body small row g-2">
            <div className="col-md-4"><strong>Scan ID:</strong> {scanDetails.scanId}</div>
            <div className="col-md-4"><strong>Scanned at:</strong> {fmtDateTime(scanDetails.scannedAt)}</div>
            <div className="col-md-4"><strong>Timezone:</strong> {scanDetails.timezone}</div>
            <div className="col-md-4"><strong>Base check-in:</strong> {scanDetails.baseCheckIn ? fmtDate(scanDetails.baseCheckIn) : '—'}</div>
            <div className="col-md-4"><strong>Days scanned:</strong> {scanDetails.days ?? '—'}</div>
            <div className="col-md-4"><strong>Stay nights:</strong> {scanDetails.stayNights ?? '—'}</div>
          </div>
        </div>
      )}

      {/* Summary Statistics */}
      {comparisonData.length > 0 && (
        <div className="card mb-3">
          <div className="card-header">
            <h5 className="mb-0">Summary Statistics</h5>
          </div>
          <div className="card-body">
            <div className="row">
              <div className="col-md-3">
                <strong>Total Comparisons:</strong> {summary.totalComparisons}
              </div>
              <div className="col-md-3">
                <strong>Both Available:</strong> {summary.bothAvailable}
              </div>
              <div className="col-md-3">
                <strong>Amello Only:</strong> {summary.amelloOnly}
              </div>
              <div className="col-md-3">
                <strong>Booking Only:</strong> {summary.bookingOnly}
              </div>
            </div>
            <div className="row mt-3">
              <div className="col-md-4">
                <strong className="text-success">Amello Cheaper:</strong> {summary.amelloCheaper} times
              </div>
              <div className="col-md-4">
                <strong className="text-danger">Booking Cheaper:</strong> {summary.bookingCheaper} times
              </div>
              <div className="col-md-4">
                <strong>Same Price:</strong> {summary.samePrice} times
              </div>
            </div>
            {summary.avgAmello && summary.avgBooking && (
              <div className="row mt-3">
                <div className="col-md-6">
                  <strong>Average Amello Price:</strong> {summary.avgAmello}
                </div>
                <div className="col-md-6">
                  <strong>Average Booking Price:</strong> {summary.avgBooking}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && <div className="alert alert-danger">{error}</div>}

      {/* Loading Indicator */}
      {loading && (
        <div className="text-center my-4">
          <div className="spinner-border text-primary" role="status"></div>
          <div className="mt-2 text-muted">Loading…</div>
        </div>
      )}

      {/* Pagination Controls */}
      {!loading && pagination.totalPages > 1 && (
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div>
            Showing page {pagination.page} of {pagination.totalPages} ({pagination.total} total records)
          </div>
          <div className="btn-group">
            <button
              className="btn btn-outline-primary"
              disabled={pagination.page <= 1}
              onClick={() => handlePageChange(pagination.page - 1)}
            >
              Previous
            </button>
            <button className="btn btn-outline-primary" disabled>
              {pagination.page} / {pagination.totalPages}
            </button>
            <button
              className="btn btn-outline-primary"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => handlePageChange(pagination.page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Comparison Table */}
      {!loading && comparisonData.length > 0 ? (
        <div className="table-responsive border rounded">
          <table className="table table-sm table-striped mb-0">
            <thead className="table-light">
              <tr>
                <th rowSpan={2}>Hotel</th>
                <th rowSpan={2}>Check-in Date</th>
                <th colSpan={3} className="text-center">
                  Amello
                </th>
                <th colSpan={3} className="text-center">
                  Booking.com
                </th>
                <th colSpan={2} className="text-center">
                  Comparison
                </th>
              </tr>
              <tr>
                <th className="text-end">Price</th>
                <th>Room</th>
                <th>Rate</th>
                <th className="text-end">Price</th>
                <th>Room</th>
                <th>Rate</th>
                <th className="text-end">Difference</th>
                <th className="text-end">% Diff</th>
              </tr>
            </thead>
            <tbody>
              {comparisonData.map((row, idx) => {
                const currency = row.amello_currency || row.booking_currency || 'EUR';
                const priceDiffClass =
                  row.price_difference === null
                    ? 'text-muted'
                    : row.price_difference > 0
                      ? 'text-danger'
                      : row.price_difference < 0
                        ? 'text-success'
                        : 'text-muted';
                
                return (
                  <tr key={idx}>
                    <td>{row.hotel_name}</td>
                    <td>{fmtDate(row.check_in_date)}</td>
                    
                    {/* Amello columns */}
                    <td className="text-end">
                      {row.amello_min_price !== null 
                        ? formatPrice(row.amello_min_price, currency) 
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="small">
                      {row.amello_room_name || <span className="text-muted">—</span>}
                    </td>
                    <td className="small">
                      {row.amello_rate_name || <span className="text-muted">—</span>}
                    </td>
                    
                    {/* Booking.com columns */}
                    <td className="text-end">
                      {row.booking_min_price !== null 
                        ? formatPrice(row.booking_min_price, currency) 
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="small">
                      {row.booking_room_name || <span className="text-muted">—</span>}
                    </td>
                    <td className="small">
                      {row.booking_rate_name || <span className="text-muted">—</span>}
                    </td>
                    
                    {/* Comparison columns */}
                    <td className={`text-end fw-bold ${priceDiffClass}`}>
                      {row.price_difference !== null 
                        ? (row.price_difference > 0 ? '+' : '') + formatPrice(row.price_difference, currency)
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className={`text-end fw-bold ${priceDiffClass}`}>
                      {row.percentage_difference !== null 
                        ? (row.percentage_difference > 0 ? '+' : '') + row.percentage_difference.toFixed(1) + '%'
                        : <span className="text-muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : !loading ? (
        <div className="alert alert-info">
          No comparison data available. Please select a scan to view results.
        </div>
      ) : null}

      {/* Bottom Pagination Controls */}
      {!loading && pagination.totalPages > 1 && (
        <div className="d-flex justify-content-between align-items-center mt-3">
          <div>
            Showing page {pagination.page} of {pagination.totalPages}
          </div>
          <div className="btn-group">
            <button
              className="btn btn-outline-primary"
              disabled={pagination.page <= 1}
              onClick={() => handlePageChange(pagination.page - 1)}
            >
              Previous
            </button>
            <button className="btn btn-outline-primary" disabled>
              {pagination.page} / {pagination.totalPages}
            </button>
            <button
              className="btn btn-outline-primary"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => handlePageChange(pagination.page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
