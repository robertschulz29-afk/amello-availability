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

type HotelRow = { id: number; name: string; code: string };

type RoomMapping = {
  id: number;
  hotel_id: number;
  amello_room: string;
  booking_room: string;
};

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
  mapped: boolean;
};

type PaginatedResponse = {
  data: RawRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

type SortKey = 'check_in_date' | 'price_amello' | 'price_booking' | 'diff';
type SortDir = 'asc' | 'desc';
type StatusFilter = 'all' | 'amello_only' | 'booking_only' | 'booking_cheaper_gt5' | 'booking_cheaper_lte5' | 'amello_cheaper';

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(dt: string) {
  try { return new Date(dt).toLocaleString(); } catch { return dt; }
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

function pctDiff(a: number | null, b: number | null): number | null {
  if (a == null || b == null || b === 0) return null;
  return ((a - b) / b) * 100;
}

// ─── pill & row coloring ──────────────────────────────────────────────────────

function pillProps(a: number | null, b: number | null): { label: string; className: string; style?: React.CSSProperties } {
  if (a != null && b == null) return { label: 'Amello only',   className: 'badge bg-primary' };
  if (a == null && b != null) return { label: 'Booking only',  className: 'badge text-white', style: { background: '#d63384' } };
  if (a != null && b != null) {
    const pct = pctDiff(a, b)!;
    if (pct > 5)  return { label: 'Booking cheaper', className: 'badge bg-danger' };
    if (pct > 0)  return { label: 'Booking cheaper', className: 'badge bg-warning text-dark' };
    return               { label: 'Amello cheaper',  className: 'badge bg-success' };
  }
  return { label: 'No price', className: 'badge bg-secondary' };
}

function rowClass(row: DisplayRow): string {
  if (!row.mapped) return 'text-muted';
  const a = row.price_amello, b = row.price_booking;
  if (a != null && b == null) return 'table-primary';
  if (a == null && b != null) return 'table-pink';
  if (a != null && b != null) {
    const pct = pctDiff(a, b)!;
    if (pct > 5)  return 'table-danger';
    if (pct > 0)  return 'table-warning';
    return               'table-success';
  }
  return '';
}

function matchesStatus(row: DisplayRow, filter: StatusFilter): boolean {
  const a = row.price_amello, b = row.price_booking;
  if (filter === 'all') return true;
  if (filter === 'amello_only')        return a != null && b == null;
  if (filter === 'booking_only')       return a == null && b != null;
  if (a == null || b == null) return false;
  const pct = pctDiff(a, b)!;
  if (filter === 'booking_cheaper_gt5')  return pct > 5;
  if (filter === 'booking_cheaper_lte5') return pct > 0 && pct <= 5;
  if (filter === 'amello_cheaper')       return pct <= 0;
  return true;
}

function sortDisplayRows(rows: DisplayRow[], key: SortKey, dir: SortDir): DisplayRow[] {
  return [...rows].sort((a, b) => {
    let av: number | string | null, bv: number | string | null;
    if (key === 'check_in_date') { av = a.check_in_date; bv = b.check_in_date; }
    else if (key === 'price_amello') { av = a.price_amello; bv = b.price_amello; }
    else if (key === 'price_booking') { av = a.price_booking; bv = b.price_booking; }
    else { av = pctDiff(a.price_amello, a.price_booking); bv = pctDiff(b.price_amello, b.price_booking); }
    if (av == null && bv == null) return 0;
    if (av == null) return dir === 'asc' ? 1 : -1;
    if (bv == null) return dir === 'asc' ? -1 : 1;
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

// ─── build display rows ───────────────────────────────────────────────────────

function buildDisplayRows(rawRows: RawRow[], mappingsByHotel: Map<number, RoomMapping[]>): DisplayRow[] {
  const amelloIdx = new Map<string, RawRow>();
  const bookingIdx = new Map<string, RawRow>();

  for (const row of rawRows) {
    const date = normalizeDate(row.check_in_date);
    const key = `${row.hotel_id}__${date}__${row.room_name}`;
    if (row.status_amello != null || row.price_amello != null) amelloIdx.set(key, row);
    if (row.status_booking != null || row.price_booking != null) bookingIdx.set(key, row);
  }

  const display: DisplayRow[] = [];
  const consumedAmello = new Set<string>();
  const consumedBooking = new Set<string>();

  const hotelDates = new Set<string>();
  for (const row of rawRows) hotelDates.add(`${row.hotel_id}__${normalizeDate(row.check_in_date)}`);

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

  for (const [key, row] of amelloIdx) {
    if (consumedAmello.has(key)) continue;
    display.push({
      hotel_id: row.hotel_id, hotel_name: row.hotel_name,
      check_in_date: normalizeDate(row.check_in_date),
      amello_room: row.room_name, booking_room: null,
      rate_name: row.rate_name,
      price_amello: toNum(row.price_amello), price_booking: null,
      status_amello: row.status_amello, status_booking: null,
      currency: row.currency ?? 'EUR', mapped: false,
    });
  }

  for (const [key, row] of bookingIdx) {
    if (consumedBooking.has(key)) continue;
    display.push({
      hotel_id: row.hotel_id, hotel_name: row.hotel_name,
      check_in_date: normalizeDate(row.check_in_date),
      amello_room: null, booking_room: row.room_name,
      rate_name: null,
      price_amello: null, price_booking: toNum(row.price_booking),
      status_amello: null, status_booking: row.status_booking,
      currency: row.currency ?? 'EUR', mapped: false,
    });
  }

  return display;
}

// ─── SortTh ───────────────────────────────────────────────────────────────────

function SortTh({ label, col, sort, onSort, className }: {
  label: string; col: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === col;
  return (
    <th
      className={`${className ?? ''} user-select-none`}
      style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
      onClick={() => onSort(col)}
    >
      {label}{' '}
      <i className={`fas fa-sort${active ? (sort.dir === 'asc' ? '-up' : '-down') : ''} text-${active ? 'primary' : 'secondary'} small`} />
    </th>
  );
}

// ─── DiffCell ─────────────────────────────────────────────────────────────────

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

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Page() {
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);
  const [hotels, setHotels] = React.useState<HotelRow[]>([]);
  const [selectedHotelId, setSelectedHotelId] = React.useState<number | null>(null);
  const [hotelSearchTerm, setHotelSearchTerm] = React.useState('');

  const [scanDetails, setScanDetails] = React.useState<{
    scanId: number; scannedAt: string;
    baseCheckIn: string | null; days: number | null;
    stayNights: number | null; timezone: string | null;
  } | null>(null);

  const [rawRows, setRawRows] = React.useState<RawRow[]>([]);
  const [mappingsByHotel, setMappingsByHotel] = React.useState<Map<number, RoomMapping[]>>(new Map());
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const [sort, setSort] = React.useState<{ key: SortKey; dir: SortDir }>({ key: 'check_in_date', dir: 'asc' });
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');

  const handleSort = (key: SortKey) =>
    setSort(prev => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }));

  // ── data loading ─────────────────────────────────────────────────────────

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

      const res: PaginatedResponse = await fetchJSON(`/api/scan-results?${params}`, { cache: 'no-store' });
      setRawRows(res.data || []);

      const mappingsData = await fetchJSON('/api/room-mappings', { cache: 'no-store' });
      const map = new Map<number, RoomMapping[]>();
      for (const h of (mappingsData.hotels ?? [])) map.set(h.id, h.mappings ?? []);
      setMappingsByHotel(map);
    } catch (e: any) {
      setError(e.message || 'Failed to load results');
      setRawRows([]);
    } finally {
      setLoading(false);
    }
  }, [selectedScanId, selectedHotelId]);

  React.useEffect(() => { loadScans(); loadHotels(); }, [loadScans, loadHotels]);
  React.useEffect(() => {
    if (selectedScanId) { loadScanDetails(selectedScanId); loadResults(); }
  }, [selectedScanId, loadScanDetails, loadResults]);

  // ── derived ──────────────────────────────────────────────────────────────

  const filteredHotels = React.useMemo(() => {
    if (!hotelSearchTerm.trim()) return hotels;
    const term = hotelSearchTerm.toLowerCase();
    return hotels.filter(h => h.name.toLowerCase().includes(term) || h.code.toLowerCase().includes(term));
  }, [hotels, hotelSearchTerm]);

  const displayRows = React.useMemo(
    () => buildDisplayRows(rawRows, mappingsByHotel),
    [rawRows, mappingsByHotel]
  );

  const filteredRows = React.useMemo(
    () => displayRows.filter(r => matchesStatus(r, statusFilter)),
    [displayRows, statusFilter]
  );

  const groupedByHotel = React.useMemo(() => {
    const map = new Map<number, DisplayRow[]>();
    for (const row of filteredRows) {
      const arr = map.get(row.hotel_id) ?? [];
      arr.push(row);
      map.set(row.hotel_id, arr);
    }
    for (const [id, rows] of map) map.set(id, sortDisplayRows(rows, sort.key, sort.dir));
    return map;
  }, [filteredRows, sort]);

  const summary = React.useMemo(() => {
    let amelloOnly = 0, bookingOnly = 0, both = 0, amelloCheaper = 0, bookingCheaper = 0, same = 0;
    let amelloSum = 0, amelloCount = 0, bookingSum = 0, bookingCount = 0, currency = 'EUR';
    for (const r of filteredRows) {
      const a = r.price_amello, b = r.price_booking;
      if (a != null && b != null) {
        both++;
        const pct = pctDiff(a, b)!;
        if (pct > 0) bookingCheaper++; else if (pct < 0) amelloCheaper++; else same++;
      } else if (a != null) { amelloOnly++; }
      else if (b != null)   { bookingOnly++; }
      if (a != null) { amelloSum += a; amelloCount++; currency = r.currency; }
      if (b != null) { bookingSum += b; bookingCount++; currency = r.currency; }
    }
    return {
      total: filteredRows.length, both, amelloOnly, bookingOnly,
      amelloCheaper, bookingCheaper, same,
      avgAmello:  amelloCount  > 0 ? formatPrice(amelloSum  / amelloCount,  currency) : null,
      avgBooking: bookingCount > 0 ? formatPrice(bookingSum / bookingCount, currency) : null,
    };
  }, [filteredRows]);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>

        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <h1 className="h3 mb-0">Price Comparison</h1>
          <a href="/room-mappings" className="btn btn-outline-secondary btn-sm">
            <i className="fa fa-sliders me-1" /> Manage Room Mappings
          </a>
        </div>

        {/* ── controls ── */}
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
              <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
            ))}
          </select>

          <select
            className="form-select"
            style={{ maxWidth: 230 }}
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">All statuses</option>
            <option value="amello_only">Amello only</option>
            <option value="booking_only">Booking only</option>
            <option value="booking_cheaper_gt5">Booking cheaper &gt;5%</option>
            <option value="booking_cheaper_lte5">Booking cheaper ≤5%</option>
            <option value="amello_cheaper">Amello cheaper</option>
          </select>
        </div>

        {/* ── scan parameters ── */}
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

        {/* ── summary ── */}
        {filteredRows.length > 0 && (
          <div className="card mb-3">
            <div className="card-header"><h6 className="mb-0">Summary</h6></div>
            <div className="card-body small">
              <div className="row g-2">
                <div className="col-md-3"><strong>Total rows:</strong> {summary.total}</div>
                <div className="col-md-3"><strong>Both available:</strong> {summary.both}</div>
                <div className="col-md-3"><strong>Amello only:</strong> {summary.amelloOnly}</div>
                <div className="col-md-3"><strong>Booking only:</strong> {summary.bookingOnly}</div>
              </div>
              <div className="row g-2 mt-1">
                <div className="col-md-3 text-success"><strong>Amello cheaper:</strong> {summary.amelloCheaper}</div>
                <div className="col-md-3 text-danger"><strong>Booking cheaper:</strong> {summary.bookingCheaper}</div>
                <div className="col-md-3"><strong>Same price:</strong> {summary.same}</div>
                <div className="col-md-3">
                  {summary.avgAmello  && <span><strong>Avg Amello:</strong> {summary.avgAmello}</span>}
                  {summary.avgBooking && <span className="ms-2"><strong>Avg Booking:</strong> {summary.avgBooking}</span>}
                </div>
              </div>
            </div>
          </div>
        )}

        {error && <div className="alert alert-danger">{error}</div>}

        {loading && (
          <div className="text-center my-4">
            <div className="spinner-border text-primary" role="status" />
            <div className="mt-2 text-muted">Loading…</div>
          </div>
        )}

        {/* ── tables grouped by hotel ── */}
        {Array.from(groupedByHotel.entries()).map(([hotelId, rows]) => (
          <div key={hotelId} className="mb-5">
            <h4 className="mb-2">{rows[0].hotel_name}</h4>

            <div className="table-responsive border rounded">
              <table className="table table-sm table-striped mb-0">
                <thead className="table-light">
                  <tr>
                    <SortTh label="Check-In"      col="check_in_date"  sort={sort} onSort={handleSort} />
                    <th>Amello Room</th>
                    <th>Booking Room</th>
                    <th>Rate</th>
                    <SortTh label="Amello Price"  col="price_amello"   sort={sort} onSort={handleSort} className="text-end" />
                    <SortTh label="Booking Price" col="price_booking"  sort={sort} onSort={handleSort} className="text-end" />
                    <SortTh label="Diff (A−B)"    col="diff"           sort={sort} onSort={handleSort} className="text-end" />
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const { label, className: pillCls, style: pillStyle } = pillProps(r.price_amello, r.price_booking);
                    return (
                      <tr key={i} className={rowClass(r)}>
                        <td className="text-nowrap">{r.check_in_date}</td>
                        <td>{r.amello_room  ?? <span className="text-muted fst-italic">—</span>}</td>
                        <td>{r.booking_room ?? <span className="text-muted fst-italic">—</span>}</td>
                        <td className="text-muted small">{r.rate_name || '—'}</td>
                        <td className="text-end text-nowrap">
                          {r.price_amello != null ? formatPrice(r.price_amello, r.currency) : <span className="text-muted">—</span>}
                        </td>
                        <td className="text-end text-nowrap">
                          {r.price_booking != null ? formatPrice(r.price_booking, r.currency) : <span className="text-muted">—</span>}
                        </td>
                        <DiffCell a={r.price_amello} b={r.price_booking} currency={r.currency} />
                        <td>
                          <span className={pillCls} style={pillStyle}>{label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {!loading && groupedByHotel.size === 0 && !error && (
          <p className="text-muted">No results found for this scan.</p>
        )}
      </div>
    </main>
  );
}
