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
): string {
  if (name && code) return `${name} (${code})`;
  if (name) return name;
  return code || 'Unknown';
}

export default function Page() {
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);

  const [hotels, setHotels] = React.useState<HotelRow[]>([]);
  const [selectedHotelId, setSelectedHotelId] = React.useState<number | null>(
    null
  );
  const [hotelSearchTerm, setHotelSearchTerm] =
    React.useState<string>('');

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
    try {
      const list = await fetchJSON('/api/scans', { cache: 'no-store' });
      const arr: ScanRow[] = Array.isArray(list) ? list : [];
      arr.sort(
        (a, b) =>
          new Date(b.scanned_at).getTime() -
          new Date(a.scanned_at).getTime()
      );
      setScans(arr);
      if (arr.length > 0 && selectedScanId == null) {
        setSelectedScanId(arr[0].id);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load scans');
    }
  }, [selectedScanId]);

  const loadHotels = React.useCallback(async () => {
    try {
      const list = await fetchJSON('/api/hotels', {
        cache: 'no-store',
      });
      const arr: HotelRow[] = Array.isArray(list) ? list : [];
      arr.sort((a, b) => a.name.localeCompare(b.name));
      setHotels(arr);
    } catch (e: any) {
      console.error('Failed to load hotels', e);
    }
  }, []);

  const loadScanDetails = React.useCallback(async (scanId: number) => {
    try {
      const data = await fetchJSON(`/api/scans/${scanId}`, {
        cache: 'no-store',
      });
      setScanDetails({
        scanId,
        scannedAt: String(data?.scannedAt ?? ''),
        baseCheckIn: data?.baseCheckIn ?? null,
        days: data?.days ?? null,
        stayNights: data?.stayNights ?? null,
        timezone: data?.timezone ?? null,
      });
    } catch {
      setScanDetails(null);
    }
  }, []);

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
        limit: '1000',
      });

      if (selectedHotelId) {
        params.append('hotelID', selectedHotelId.toString());
      }

      const url = `/api/scan-results?${params.toString()}`;
      const data: PaginatedResponse = await fetchJSON(url, {
        cache: 'no-store',
      });

      setResults(data.data || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load results');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [selectedScanId, selectedHotelId]);

  React.useEffect(() => {
    loadScans();
  }, [loadScans]);

  React.useEffect(() => {
    loadHotels();
  }, [loadHotels]);

  React.useEffect(() => {
    if (selectedScanId != null) {
      loadScanDetails(selectedScanId);
      loadResults();
    }
  }, [selectedScanId, loadScanDetails, loadResults]);

  const filteredHotels = React.useMemo(() => {
    if (!hotelSearchTerm.trim()) return hotels;
    const term = hotelSearchTerm.toLowerCase();
    return hotels.filter(
      (h) =>
        h.name.toLowerCase().includes(term) ||
        h.code.toLowerCase().includes(term) ||
        h.id.toString().includes(term)
    );
  }, [hotels, hotelSearchTerm]);

  // ✅ GROUP BY HOTEL ONLY
  const groupedData = React.useMemo(() => {
    const grouped: {
      [hotelId: number]: {
        hotelName: string;
        rows: ComparisonRow[];
      };
    } = {};

    for (const row of results) {
      if (!grouped[row.hotel_id]) {
        grouped[row.hotel_id] = {
          hotelName: row.hotel_name,
          rows: [],
        };
      }
      grouped[row.hotel_id].rows.push(row);
    }

    return grouped;
  }, [results]);

  const calculateDifference = (
    amelloPrice: number | null,
    bookingPrice: number | null
  ) => {
    if (amelloPrice == null || bookingPrice == null) return null;
    if (bookingPrice === 0 && amelloPrice === 0) return null;
    if (bookingPrice === 0) {
      return { diff: amelloPrice, pct: 0 };
    }
    const diff = amelloPrice - bookingPrice;
    const pct = (diff / bookingPrice) * 100;
    return { diff, pct };
  };

  const getStatusBadgeClass = (
    statusAmello: string | null,
    statusBooking: string | null
  ) => {
    if (statusAmello === 'green' && statusBooking === 'green')
      return 'bg-success';
    if (statusAmello === 'green' || statusBooking === 'green')
      return 'bg-warning';
    return 'bg-danger';
  };

  return (
    <main>
      <h1 className="h3 mb-3">Price Comparison</h1>

      {error && <div className="alert alert-danger">{error}</div>}

      {loading ? (
        <div className="text-center py-4">
          <div className="spinner-border" />
        </div>
      ) : results.length > 0 ? (
        <>
          {Object.entries(groupedData).map(
            ([hotelId, hotelData]) => (
              <div key={hotelId} className="mb-4">
                <h4>{hotelData.hotelName}</h4>

                <div className="table-responsive border rounded">
                  <table className="table table-sm table-striped mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Hotel</th>
                        <th>Check-In</th>
                        <th>Room Name</th>
                        <th>Rate Name</th>
                        <th className="text-end">
                          Price (Amello)
                        </th>
                        <th className="text-end">
                          Price (Booking.com)
                        </th>
                        <th className="text-end">
                          Difference
                        </th>
                        <th className="text-center">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {hotelData.rows
                        .sort((a, b) =>
                          a.check_in_date.localeCompare(
                            b.check_in_date
                          )
                        )
                        .map((row, idx) => {
                          const diff =
                            calculateDifference(
                              row.price_amello,
                              row.price_booking
                            );
                          const statusClass =
                            getStatusBadgeClass(
                              row.status_amello,
                              row.status_booking
                            );

                          return (
                            <tr key={idx}>
                              <td>{hotelData.hotelName}</td>
                              <td>{row.check_in_date}</td>
                              <td>
                                {row.room_name || '—'}
                              </td>
                              <td>
                                {row.rate_name || '—'}
                              </td>

                              <td className="text-end">
                                {row.price_amello !=
                                null ? (
                                  <span
                                    className={
                                      row.status_amello ===
                                      'green'
                                        ? 'text-success'
                                        : 'text-danger'
                                    }
                                  >
                                    {formatPrice(
                                      row.price_amello,
                                      row.currency
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-muted">
                                    —
                                  </span>
                                )}
                              </td>

                              <td className="text-end">
                                {row.price_booking !=
                                null ? (
                                  <span
                                    className={
                                      row.status_booking ===
                                      'green'
                                        ? 'text-success'
                                        : 'text-danger'
                                    }
                                  >
                                    {formatPrice(
                                      row.price_booking,
                                      row.currency
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-muted">
                                    —
                                  </span>
                                )}
                              </td>

                              <td className="text-end">
                                {diff ? (
                                  <span
                                    className={
                                      diff.diff < 0
                                        ? 'text-success'
                                        : diff.diff > 0
                                        ? 'text-danger'
                                        : ''
                                    }
                                  >
                                    {diff.diff < 0
                                      ? ''
                                      : '+'}
                                    {formatPrice(
                                      diff.diff,
                                      row.currency
                                    )}{' '}
                                    (
                                    {diff.pct > 0
                                      ? '+'
                                      : ''}
                                    {diff.pct.toFixed(1)}%)
                                  </span>
                                ) : (
                                  <span className="text-muted">
                                    —
                                  </span>
                                )}
                              </td>

                              <td className="text-center">
                                <span
                                  className={`badge ${statusClass}`}
                                >
                                  {row.status_amello ===
                                    'green' &&
                                  row.status_booking ===
                                    'green'
                                    ? 'Both'
                                    : row.status_amello ===
                                      'green'
                                    ? 'Amello Only'
                                    : row.status_booking ===
                                      'green'
                                    ? 'Booking Only'
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
            )
          )}
        </>
      ) : (
        <p className="text-muted">
          No results found.
        </p>
      )}
    </main>
  );
}
