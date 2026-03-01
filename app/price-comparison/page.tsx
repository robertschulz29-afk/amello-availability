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

type RoomMapping = {
  id: number;
  hotel_id: number;
  amello_room: string;
  booking_room: string;
};

// Raw row as returned by the API
type RawRow = {
  hotel_id: number;
  hotel_name: string;
  check_in_date: string;
  room_name: string;
  rate_name: string | null;
  price_amello: string | null;
  price_booking: string | null;
  status_amello: 'green' | 'red' | null;
  status_booking: 'green' | 'red' | null;
  currency: string;
};

// Display row — either a joined mapped pair or a single unmapped row
type DisplayRow = {
  hotel_id: number;
  hotel_name: string;
  check_in_date: string;
  amello_room: string | null;
  booking_room: string | null;
  rate_name: string | null;
  price_amello: number | null;
  price_booking: number | null;
  status_amello: 'green' | 'red' | null;
  status_booking: 'green' | 'red' | null;
  currency: string;
  mapped: boolean; // true = joined via mapping, false = unmapped passthrough
};

type PaginatedResponse = {
  data: RawRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

function fmtDateTime(dt: string) {
  try { return new Date(dt).toLocaleString(); } catch { return dt; }
}

function getHotelDisplay(name: string | null | undefined, code: string | null | undefined) {
  if (name && code) return `${name} (${code})`;
  return name || code || 'Unknown';
}

function toNum(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function normalizeDate(d: string): string {
  const m = String(d).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : d;
}

/**
 * Build display rows:
 * 1. For each mapping that has at least one side of data → one joined row
 * 2. Amello rows not consumed by any mapping → passthrough row
 * 3. Booking rows not consumed by any mapping → passthrough row
 */
function buildDisplayRows(rawRows: RawRow[], mappingsByHotel: Map<number, RoomMapping[]>): DisplayRow[] {
  // Index by hotel_id__date__room_name
  const amelloIdx = new Map<string, RawRow>();
  const bookingIdx = new Map<string, RawRow>();

  for (const row of rawRows) {
    const date = normalizeDate(row.check_in_date);
    const key = `${row.hotel_id}__${date}__${row.room_name}`;
    if (row.status_amello != null || row.price_amello != null) amelloIdx.set(key, row);
    if (row.status_booking != null || row.price_booking != null) bookingIdx.set(key, row);
  }

  const display: DisplayRow[] = [];
  // Track which raw keys have been consumed by a mapping
  const consumedAmello = new Set<string>();
  const consumedBooking = new Set<string>();

  // Collect all unique hotel+date combos
  const hotelDates = new Set<string>();
  for (const row of rawRows) {
    hotelDates.add(`${row.hotel_id}__${normalizeDate(row.check_in_date)}`);
  }

  // 1. Mapped (joined) rows
  for (const hotelDate of hotelDates) {
    const [hotelIdStr, date] = hotelDate.split('__');
    const hotelId = Number(hotelIdStr);
    const mappings = mappingsByHotel.get(hotelId) ?? [];

    for (const mapping of mappings) {
      const amelloKey = `${hotelId}__${date}__${mapping.amello_room}`;
      const bookingKey = `${hotelId}__${date}__${mapping.booking_room}`;

      const amelloRow = amelloIdx.get(amelloKey);
      const bookingRow = bookingIdx.get(bookingKey);

      if (!amelloRow && !bookingRow) continue;

      consumedAmello.add(amelloKey);
      consumedBooking.add(bookingKey);

      display.push({
        hotel_id: hotelId,
        hotel_name: (amelloRow ?? bookingRow)!.hotel_name,
        check_in_date: date,
        amello_room: mapping.amello_room,
        booking_room: mapping.booking_room,
        rate_name: amelloRow?.rate_name ?? null,
        price_amello: toNum(amelloRow?.price_amello),
        price_booking: toNum(bookingRow?.price_booking),
        status_amello: amelloRow?.status_amello ?? null,
        status_booking: bookingRow?.status_booking ?? null,
        currency: (amelloRow ?? bookingRow)!.currency ?? 'EUR',
        mapped: true,
      });
    }
  }

  // 2. Unmapped amello rows
  for (const [key, row] of amelloIdx) {
    if (consumedAmello.has(key)) continue;
    display.push({
      hotel_id: row.hotel_id,
      hotel_name: row.hotel_name,
      check_in_date: normalizeDate(row.check_in_date),
      amello_room: row.room_name,
      booking_room: null,
      rate_name: row.rate_name,
      price_amello: toNum(row.price_amello),
      price_booking: null,
      status_amello: row.status_amello,
      status_booking: null,
      currency: row.currency ?? 'EUR',
      mapped: false,
    });
  }

  // 3. Unmapped booking rows
  for (const [key, row] of bookingIdx) {
    if (consumedBooking.has(key)) continue;
    display.push({
      hotel_id: row.hotel_id,
      hotel_name: row.hotel_name,
      check_in_date: normalizeDate(row.check_in_date),
      amello_room: null,
      booking_room: row.room_name,
      rate_name: null,
      price_amello: null,
      price_booking: toNum(row.price_booking),
      status_amello: null,
      status_booking: row.status_booking,
      currency: row.currency ?? 'EUR',
      mapped: false,
    });
  }

  display.sort((a, b) =>
    a.hotel_name.localeCompare(b.hotel_name) ||
    a.check_in_date.localeCompare(b.check_in_date) ||
    // mapped rows first within same date
    (b.mapped ? 1 : 0) - (a.mapped ? 1 : 0)
  );

  return display;
}

function DiffCell({ a, b, currency }: { a: number | null; b: number | null; currency: string }) {
  if (a == null || b == null) return <td className="text-end text-muted">—</td>;
  const diff = a - b;
  const pct = b !== 0 ? (diff / b) * 100 : 0;
  const cls = diff > 0 ? 'text-danger' : diff < 0 ? 'text-success' : 'text-muted';
  return (
    <td className={`text-end ${cls}`}>
      {diff > 0 ? '+' : ''}{formatPrice(diff, currency)}
      <br /><small>({pct > 0 ? '+' : ''}{pct.toFixed(1)}%)</small>
    </td>
  );
}

function StatusBadge({ a, b }: { a: 'green' | 'red' | null; b: 'green' | 'red' | null }) {
  if (a === 'green' && b === 'green') return <span className="badge bg-success">Both</span>;
  if (a === 'green') return <span className="badge bg-warning text-dark">Amello only</span>;
  if (b === 'green') return <span className="badge bg-warning text-dark">Booking only</span>;
  return <span className="badge bg-danger">None</span>;
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

  const [rawRows, setRawRows] = React.useState<RawRow[]>([]);
  const [mappingsByHotel, setMappingsByHotel] = React.useState<Map<number, RoomMapping[]>>(new Map());
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
      if (selectedHotelId) params.append('hotelID', selectedHotelId.toString());

      const res: PaginatedResponse = await fetchJSON(
        `/api/scan-results?${params}`,
        { cache: 'no-store' }
      );
      const rows = res.data || [];
      setRawRows(rows);

      // Load mappings for every hotel in the result set
      const hotelIds = [...new Set(rows.map(r => r.hotel_id))];
      const allMappings = await Promise.all(
        hotelIds.map(id =>
          fetchJSON(`/api/room-mappings?hotelId=${id}`, { cache: 'no-store' })
            .then((d: any) => ({ hotelId: id, mappings: (d.mappings ?? []) as RoomMapping[] }))
            .catch(() => ({ hotelId: id, mappings: [] as RoomMapping[] }))
        )
      );
      const map = new Map<number, RoomMapping[]>();
      for (const { hotelId, mappings } of allMappings) map.set(hotelId, mappings);
      setMappingsByHotel(map);

    } catch (e: any) {
      setError(e.message || 'Failed to load results');
      setRawRows([]);
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
      h.name.toLowerCase().includes(term) || h.code.toLowerCase().includes(term)
    );
  }, [hotels, hotelSearchTerm]);

  const displayRows = React.useMemo(
    () => buildDisplayRows(rawRows, mappingsByHotel),
    [rawRows, mappingsByHotel]
  );

  // Group by hotel
  const groupedByHotel = React.useMemo(() => {
    const map = new Map<number, DisplayRow[]>();
    for (const row of displayRows) {
      const arr = map.get(row.hotel_id) ?? [];
      arr.push(row);
      map.set(row.hotel_id, arr);
    }
    return map;
  }, [displayRows]);

  return (
    <main>
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h1 className="h3 mb-0">Price Comparison</h1>
        <a href="/room-mappings" className="btn btn-outline-secondary btn-sm">
          <i className="fa fa-sliders me-1"></i> Manage Room Mappings
        </a>
      </div>

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
          style={{ maxWidth: 200 }}
          placeholder="Search hotels..."
          value={hotelSearchTerm}
          onChange={e => setHotelSearchTerm(e.target.value)}
        />

        <select
          className="form-select"
          style={{ maxWidth: 300 }}
          value={selectedHotelId ?? ''}
          onChange={e => setSelectedHotelId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">All Hotels</option>
          {filteredHotels.map(h => (
            <option key={h.id} value={h.id}>{getHotelDisplay(h.name, h.code)}</option>
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

      {loading && (
        <div className="text-center my-4">
          <div className="spinner-border text-primary" role="status"></div>
          <div className="mt-2 text-muted">Loading…</div>
        </div>
      )}

      {Array.from(groupedByHotel.entries()).map(([hotelId, rows]) => {
        const hotelMappings = mappingsByHotel.get(hotelId) ?? [];
        const mappedCount = rows.filter(r => r.mapped).length;
        const unmappedCount = rows.filter(r => !r.mapped).length;

        return (
          <div key={hotelId} className="mb-5">
            <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
              <h4 className="mb-0">{rows[0].hotel_name}</h4>
              
              
            </div>

            <div className="table-responsive border rounded">
              <table className="table table-sm table-striped mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Check-In</th>
                    <th>Amello Room</th>
                    <th>Booking Room</th>
                    <th>Rate</th>
                    <th className="text-end">Amello Price</th>
                    <th className="text-end">Booking Price</th>
                    <th className="text-end">Diff (A−B)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={!r.mapped ? 'text-muted' : ''}>
                      <td className="text-nowrap">{r.check_in_date}</td>
                      <td>
                        {r.amello_room ?? <span className="text-muted fst-italic">—</span>}
                      </td>
                      <td>
                        {r.booking_room
                          ? <>
                              {r.booking_room}
                              
                            </>
                          : <span className="text-muted fst-italic">—</span>
                        }
                      </td>
                      <td className="text-muted small">{r.rate_name || '—'}</td>
                      <td className="text-end text-nowrap">
                        {r.price_amello != null
                          ? formatPrice(r.price_amello, r.currency)
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="text-end text-nowrap">
                        {r.price_booking != null
                          ? formatPrice(r.price_booking, r.currency)
                          : <span className="text-muted">—</span>}
                      </td>
                      <DiffCell a={r.price_amello} b={r.price_booking} currency={r.currency} />
                      <td>
                        <StatusBadge a={r.status_amello} b={r.status_booking} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {!loading && displayRows.length === 0 && !error && (
        <p className="text-muted">No results found for this scan.</p>
      )}
    </main>
  );
}
