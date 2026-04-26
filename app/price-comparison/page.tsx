// app/price-comparison/page.tsx
'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { fetchJSON } from '@/lib/api-client';
import { formatPrice } from '@/lib/price-utils';
import { HotelCombobox } from '@/app/components/HotelCombobox';

type ScanRow = {
  id: number;
  scanned_at: string;
  stay_nights: number;
  total_cells: number;
  done_cells: number;
  status: 'queued' | 'running' | 'done' | 'error';
};

type HotelRow = { id: number; name: string; code: string; brand?: string; country?: string; region?: string; tuiamello_url?: string | null; booking_url?: string | null };

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
  price_booking_member: string | null;
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
  price_booking_member: number | null;
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
type StatusFilter = 'all' | 'amello_only' | 'booking_only' | 'booking_cheaper_gt5' | 'booking_cheaper_lte5' | 'booking_cheaper' | 'amello_cheaper';

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
  if (filter === 'booking_cheaper')      return pct > 0;
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
        price_booking_member: toNum(bookingRow?.price_booking_member),
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
      price_amello: toNum(row.price_amello), price_booking: null, price_booking_member: null,
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
      price_amello: null, price_booking: toNum(row.price_booking), price_booking_member: toNum(row.price_booking_member),
      status_amello: null, status_booking: row.status_booking,
      currency: row.currency ?? 'EUR', mapped: false,
    });
  }

  return display;
}

// ─── URL helpers ─────────────────────────────────────────────────────────────

function buildAmelloUrl(tuiamelloUrl: string | null | undefined, checkIn: string, stayNights: number | null): string | null {
  if (!tuiamelloUrl) return null;
  try {
    const base = tuiamelloUrl.endsWith('/') ? tuiamelloUrl : tuiamelloUrl + '/';
    const dep = new Date(checkIn);
    if (isNaN(dep.getTime())) return null;
    const ret = new Date(dep);
    ret.setDate(ret.getDate() + (stayNights ?? 7));
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return `${base}?departure-date=${fmt(dep)}&return-date=${fmt(ret)}&rooms=2`;
  } catch { return null; }
}

function buildBookingUrl(bookingUrl: string | null | undefined, checkIn: string, stayNights: number | null): string | null {
  if (!bookingUrl) return null;
  try {
    const url = new URL(bookingUrl);
    url.searchParams.set('checkin', checkIn);
    const dep = new Date(checkIn);
    if (!isNaN(dep.getTime())) {
      const checkout = new Date(dep);
      checkout.setDate(checkout.getDate() + (stayNights ?? 7));
      url.searchParams.set('checkout', checkout.toISOString().slice(0, 10));
    }
    return url.toString();
  } catch { return null; }
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

function PriceComparisonPage() {
  const searchParams = useSearchParams();
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(
    searchParams.get('scanId') ? Number(searchParams.get('scanId')) : null
  );
  const [hotels, setHotels] = React.useState<HotelRow[]>([]);
  const [selectedHotelIds, setSelectedHotelIds] = React.useState<number[]>([]);

  const [scanDetails, setScanDetails] = React.useState<{
    scanId: number; scannedAt: string;
    baseCheckIn: string | null; days: number | null;
    stayNights: number | null; timezone: string | null;
  } | null>(null);

  const [scanHotels, setScanHotels] = React.useState<{ hotel_id: number; hotel_name: string }[]>([]);
  const [rawRows, setRawRows] = React.useState<RawRow[]>([]);
  const [mappingsByHotel, setMappingsByHotel] = React.useState<Map<number, RoomMapping[]>>(new Map());
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadingHotels, setLoadingHotels] = React.useState(false);

  const [sort, setSort] = React.useState<{ key: SortKey; dir: SortDir }>({ key: 'check_in_date', dir: 'asc' });
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>(
    (searchParams.get('filter') as StatusFilter) ?? 'all'
  );
  const [groupBy, setGroupBy] = React.useState<'none' | 'brand' | 'country' | 'region'>('none');
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set());
  const [displayPage, setDisplayPage] = React.useState(1);
  const [hotelsPerPage, setHotelsPerPage] = React.useState(10);

  const toggleGroup = (key: string) =>
    setCollapsedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const handleSort = (key: SortKey) =>
    setSort(prev => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }));

  // ── data loading ─────────────────────────────────────────────────────────

  const loadScans = React.useCallback(async () => {
    const list = await fetchJSON('/api/scans', { cache: 'no-store' });
    const arr: ScanRow[] = Array.isArray(list) ? list : [];
    arr.sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());
    setScans(arr);
    setSelectedScanId(prev => prev ?? (arr.length > 0 ? arr[0].id : null));
  }, []);

  const loadHotels = React.useCallback(async () => {
    const list = await fetchJSON('/api/hotels?slim=1', { cache: 'no-store' });
    const arr: HotelRow[] = Array.isArray(list) ? list : [];
    arr.sort((a, b) => a.name.localeCompare(b.name));
    setHotels(arr);
  }, []);

  const loadScanDetails = React.useCallback(async (scanId: number) => {
    const data = await fetchJSON(`/api/scans/${scanId}?meta=1`, { cache: 'no-store' });
    setScanDetails({
      scanId,
      scannedAt: String(data?.scannedAt ?? ''),
      baseCheckIn: data?.baseCheckIn ?? null,
      days: data?.days ?? null,
      stayNights: data?.stayNights ?? null,
      timezone: data?.timezone ?? null,
    });
  }, []);

  // Step 1: fetch hotel list for the scan (lightweight), reset page when scan/filter changes
  React.useEffect(() => {
    if (!selectedScanId) { setScanHotels([]); return; }
    setLoadingHotels(true);
    setDisplayPage(1);
    const params = new URLSearchParams({ scanID: selectedScanId.toString() });
    if (selectedHotelIds.length > 0) params.append('hotelID', selectedHotelIds.join(','));
    fetchJSON(`/api/scan-results/hotels?${params}`, { cache: 'no-store' })
      .then(rows => setScanHotels(Array.isArray(rows) ? rows : []))
      .catch(e => { setError(e.message); setScanHotels([]); })
      .finally(() => setLoadingHotels(false));
    loadScanDetails(selectedScanId);
  }, [selectedScanId, selectedHotelIds, loadScanDetails]);

  // Step 2: fetch comparison rows for current page's hotel slice whenever page/size/hotels change
  React.useEffect(() => {
    if (!selectedScanId || scanHotels.length === 0) { setRawRows([]); return; }
    const pageStart = (displayPage - 1) * hotelsPerPage;
    const pageHotelIds = scanHotels.slice(pageStart, pageStart + hotelsPerPage).map(h => h.hotel_id);
    if (pageHotelIds.length === 0) { setRawRows([]); return; }

    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      scanID: selectedScanId.toString(),
      format: 'comparison',
      limit: '5000',
      hotelID: pageHotelIds.join(','),
    });
    Promise.all([
      fetchJSON(`/api/scan-results?${params}`, { cache: 'no-store' }),
      fetchJSON('/api/room-mappings', { cache: 'no-store' }),
    ]).then(([res, mappingsData]) => {
      setRawRows((res as PaginatedResponse).data || []);
      const map = new Map<number, RoomMapping[]>();
      for (const h of (mappingsData.hotels ?? [])) map.set(h.id, h.mappings ?? []);
      setMappingsByHotel(map);
    }).catch(e => {
      setError(e.message || 'Failed to load results');
      setRawRows([]);
    }).finally(() => setLoading(false));
  }, [selectedScanId, scanHotels, displayPage, hotelsPerPage]);

  React.useEffect(() => { loadScans(); loadHotels(); }, []);

  // ── derived ──────────────────────────────────────────────────────────────

  const hotelMeta = React.useMemo(() =>
    new Map(hotels.map(h => [h.id, h])),
  [hotels]);


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

  const groupedByDimension = React.useMemo(() => {
    if (groupBy === 'none') return null;
    const outer = new Map<string, number[]>();
    for (const [hotelId] of groupedByHotel) {
      const meta = hotelMeta.get(hotelId);
      const label = (meta?.[groupBy] ?? '') || '—';
      const arr = outer.get(label) ?? [];
      arr.push(hotelId);
      outer.set(label, arr);
    }
    return new Map([...outer.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }, [groupBy, groupedByHotel, hotelMeta]);

  // Pagination derived values
  const totalHotels = scanHotels.length;
  const totalPages = Math.max(1, Math.ceil(totalHotels / hotelsPerPage));
  const safePage = Math.min(displayPage, totalPages);
  const pageStart = (safePage - 1) * hotelsPerPage;

  // Current page's render units (groups or hotel IDs from loaded rows)
  const pageUnits = groupedByDimension
    ? Array.from(groupedByDimension.keys())
    : Array.from(groupedByHotel.keys());

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

  const hotelTable = (rows: DisplayRow[], hotelId: number) => {
    const meta = hotelMeta.get(hotelId);
    const stayNights = scanDetails?.stayNights ?? null;
    return (<>
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
            <th className="text-end text-nowrap">Member Price</th>
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
                <td className="small">{r.rate_name || '—'}</td>
                <td className="text-end text-nowrap">
                  {r.price_amello != null ? (() => {
                    const href = buildAmelloUrl(meta?.tuiamello_url, r.check_in_date, stayNights);
                    return href
                      ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-decoration-none">{formatPrice(r.price_amello, r.currency)}</a>
                      : formatPrice(r.price_amello, r.currency);
                  })() : <span className="text-muted">—</span>}
                </td>
                <td className="text-end text-nowrap">
                  {r.price_booking != null ? (() => {
                    const href = buildBookingUrl(meta?.booking_url, r.check_in_date, stayNights);
                    return href
                      ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-decoration-none">{formatPrice(r.price_booking, r.currency)}</a>
                      : formatPrice(r.price_booking, r.currency);
                  })() : <span className="text-muted">—</span>}
                </td>
                <td className="text-end text-nowrap">
                  {r.price_booking_member != null ? (() => {
                    const href = buildBookingUrl(meta?.booking_url, r.check_in_date, stayNights);
                    return href
                      ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary fw-semibold text-decoration-none">{formatPrice(r.price_booking_member, r.currency)}</a>
                      : <span className="text-primary fw-semibold">{formatPrice(r.price_booking_member, r.currency)}</span>;
                  })() : <span className="text-muted">—</span>}
                </td>
                <DiffCell a={r.price_amello} b={r.price_booking} currency={r.currency} />
                <td><span className={pillCls} style={pillStyle}>{label}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>);
  };

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>

        <div className="d-flex justify-content-end mb-3">
          <a href="/room-mappings" className="btn btn-outline-secondary btn-sm">
            <i className="fa fa-sliders me-1" /> Manage Room Mappings
          </a>
        </div>

        {/* ── controls ── */}
        <div className="d-flex gap-3 mb-3 flex-wrap">
          <HotelCombobox
            hotels={hotels}
            selectedIds={selectedHotelIds}
            onChange={setSelectedHotelIds}
            placeholder="All Hotels"
            style={{ maxWidth: 300 }}
          />

          <select
            className="form-select"
            style={{ maxWidth: 230 }}
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">All statuses</option>
            <option value="amello_only">Amello only</option>
            <option value="booking_only">Booking only</option>
            <option value="booking_cheaper">Booking cheaper (all)</option>
            <option value="booking_cheaper_gt5">Booking cheaper &gt;5%</option>
            <option value="booking_cheaper_lte5">Booking cheaper ≤5%</option>
            <option value="amello_cheaper">Amello cheaper</option>
          </select>

          <select className="form-select" style={{ maxWidth: 180 }} value={groupBy} onChange={e => { setGroupBy(e.target.value as typeof groupBy); setCollapsedGroups(new Set()); }}>
            <option value="none">No grouping</option>
            <option value="brand">Group by Brand</option>
            <option value="country">Group by Country</option>
            <option value="region">Group by Region</option>
          </select>

          <div className="d-flex align-items-center gap-2">
            <label className="form-label mb-0 text-nowrap small">Hotels per page:</label>
            <select className="form-select form-select-sm" style={{ width: 'auto' }} value={hotelsPerPage} onChange={e => setHotelsPerPage(Number(e.target.value))}>
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
        </div>

        {/* ── scan parameters ── */}
        <div className="card mb-3">
          <div className="card-header">Scan Parameters</div>
          <div className="card-body small">
            <select className="form-select form-select-sm mb-2" style={{ maxWidth: 500 }} value={selectedScanId ?? ''} onChange={e => setSelectedScanId(Number(e.target.value))}>
              {scans.map(s => (
                <option key={s.id} value={s.id}>#{s.id} • {fmtDateTime(s.scanned_at)} • {s.status}</option>
              ))}
            </select>
            {scanDetails && (
              <div className="row g-2">
                <div className="col-md-4"><strong>Scan ID:</strong> {scanDetails.scanId}</div>
                <div className="col-md-4"><strong>Scanned at:</strong> {fmtDateTime(scanDetails.scannedAt)}</div>
                <div className="col-md-4"><strong>Timezone:</strong> {scanDetails.timezone}</div>
                <div className="col-md-4"><strong>Base check-in:</strong> {scanDetails.baseCheckIn}</div>
                <div className="col-md-4"><strong>Days scanned:</strong> {scanDetails.days}</div>
                <div className="col-md-4"><strong>Stay nights:</strong> {scanDetails.stayNights}</div>
              </div>
            )}
          </div>
        </div>

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

        {/* ── pagination controls (top) ── */}
        {totalHotels > 0 && (
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div className="text-muted small">
              Showing hotels {pageStart + 1}–{Math.min(pageStart + hotelsPerPage, totalHotels)} of {totalHotels}
            </div>
            <div className="d-flex gap-2">
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setDisplayPage(1)} disabled={safePage === 1}>First</button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setDisplayPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>Prev</button>
              <span className="align-self-center px-2 small">Page {safePage} of {totalPages}</span>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setDisplayPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Next</button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setDisplayPage(totalPages)} disabled={safePage === totalPages}>Last</button>
            </div>
          </div>
        )}

        {/* ── tables grouped by hotel (optionally wrapped in dimension groups) ── */}
        {groupedByDimension
          ? pageUnits.map(groupLabel => {
            const hotelIds = groupedByDimension.get(groupLabel as string)!;
            return (
              <div key={groupLabel} className="mb-4">
                <button
                  className="btn btn-light border w-100 text-start fw-semibold d-flex justify-content-between align-items-center mb-2 px-3 py-2"
                  onClick={() => toggleGroup(groupLabel as string)}
                >
                  <span>{groupLabel} <span className="text-muted fw-normal small ms-1">({hotelIds.length} hotel{hotelIds.length !== 1 ? 's' : ''})</span></span>
                  <i className={`fas fa-chevron-${collapsedGroups.has(groupLabel as string) ? 'down' : 'up'} small`} />
                </button>
                {!collapsedGroups.has(groupLabel as string) && hotelIds.map(hotelId => {
                  const rows = groupedByHotel.get(hotelId)!;
                  return (
                    <div key={hotelId} className="mb-4 ms-3">
                      <h5 className="mb-2">{rows[0].hotel_name}</h5>
                      {hotelTable(rows, hotelId)}
                    </div>
                  );
                })}
              </div>
            );
          })
          : pageUnits.map(hotelId => {
            const rows = groupedByHotel.get(hotelId as number)!;
            return (
              <div key={hotelId} className="mb-5">
                <h4 className="mb-2">{rows[0].hotel_name}</h4>
                {hotelTable(rows, hotelId as number)}
              </div>
            );
          })
        }

        {/* ── pagination controls (bottom) ── */}
        {totalHotels > 0 && (
          <div className="d-flex justify-content-between align-items-center mt-2 mb-4">
            <div className="text-muted small">
              Showing hotels {pageStart + 1}–{Math.min(pageStart + hotelsPerPage, totalHotels)} of {totalHotels}
            </div>
            <div className="d-flex gap-2">
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setDisplayPage(1)} disabled={safePage === 1}>First</button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setDisplayPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>Prev</button>
              <span className="align-self-center px-2 small">Page {safePage} of {totalPages}</span>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setDisplayPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Next</button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setDisplayPage(totalPages)} disabled={safePage === totalPages}>Last</button>
            </div>
          </div>
        )}

        {!loading && groupedByHotel.size === 0 && !error && (
          <p className="text-muted">No results found for this scan.</p>
        )}
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <PriceComparisonPage />
    </React.Suspense>
  );
}
