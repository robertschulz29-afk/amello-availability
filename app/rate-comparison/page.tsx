// app/rate-comparison/page.tsx
'use client';

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';
import { formatPrice } from '@/lib/price-utils';
import { HotelCombobox } from '@/app/components/HotelCombobox';

// ─── shared types ─────────────────────────────────────────────────────────────

type ScanRow = {
  id: number;
  scanned_at: string;
  stay_nights: number;
  total_cells: number;
  done_cells: number;
  status: 'queued' | 'running' | 'done' | 'error';
};

type HotelRow = { id: number; name: string; code: string; brand?: string; country?: string; region?: string };

// ─── best-rate types ──────────────────────────────────────────────────────────

type RateRow = {
  scan_id: number;
  hotel_id: number;
  hotel_name: string;
  check_in_date: string;
  amello_min_price: number | null;
  amello_currency: string | null;
  amello_room_name: string | null;
  amello_rate_name: string | null;
  booking_min_price: number | null;
  booking_member_min_price: number | null;
  booking_currency: string | null;
  booking_room_name: string | null;
  booking_rate_name: string | null;
  price_difference: number | null;
  percentage_difference: number | null;
};

// ─── all-rates types ──────────────────────────────────────────────────────────

type RoomMapping = { id: number; hotel_id: number; amello_room: string; booking_room: string };

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

// ─── view / sort types ────────────────────────────────────────────────────────

type ViewMode = 'best_rate' | 'all_rates';
type BestRateSortKey = 'check_in_date' | 'amello_min_price' | 'booking_min_price' | 'price_difference' | 'percentage_difference';
type AllRatesSortKey = 'check_in_date' | 'price_amello' | 'price_booking' | 'diff';
type SortDir = 'asc' | 'desc';
type StatusFilter = 'all' | 'amello_only' | 'booking_only' | 'booking_cheaper_gt5' | 'booking_cheaper_lte5' | 'booking_cheaper' | 'amello_cheaper';

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(dt: string) { try { return new Date(dt).toLocaleString(); } catch { return dt; } }
function fmtDate(dt: string)     { try { return new Date(dt).toLocaleDateString(); } catch { return dt; } }

function toNum(v: unknown): number | null {
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

// ─── pill & row coloring (best-rate) ─────────────────────────────────────────

function ratePillProps(row: RateRow): { label: string; className: string; style?: React.CSSProperties } {
  const a = row.amello_min_price;
  const b = row.booking_min_price ?? row.booking_member_min_price;
  if (a != null && b == null) return { label: 'Amello only',   className: 'badge bg-primary' };
  if (a == null && b != null) return { label: 'Booking only',  className: 'badge text-white', style: { background: '#d63384' } };
  if (a != null && b != null) {
    const pct = b !== 0 ? ((a - b) / b) * 100 : 0;
    if (pct > 5)  return { label: 'Booking cheaper', className: 'badge bg-danger' };
    if (pct > 0)  return { label: 'Booking cheaper', className: 'badge bg-warning text-dark' };
    return               { label: 'Amello cheaper',  className: 'badge bg-success' };
  }
  return { label: 'No price', className: 'badge bg-secondary' };
}

function rateBgClass(row: RateRow): string {
  const a = row.amello_min_price;
  const b = row.booking_min_price ?? row.booking_member_min_price;
  if (a != null && b == null) return 'table-primary';
  if (a == null && b != null) return 'table-pink';
  if (a != null && b != null) {
    const pct = b !== 0 ? ((a - b) / b) * 100 : 0;
    if (pct > 5)  return 'table-danger';
    if (pct > 0)  return 'table-warning';
    return               'table-success';
  }
  return '';
}

function matchesRateStatus(row: RateRow, filter: StatusFilter): boolean {
  const a = row.amello_min_price;
  const b = row.booking_min_price ?? row.booking_member_min_price;
  if (filter === 'all') return true;
  if (filter === 'amello_only')  return a != null && row.booking_min_price == null && row.booking_member_min_price == null;
  if (filter === 'booking_only') return a == null && b != null;
  if (a == null || b == null) return false;
  const pct = b !== 0 ? ((a - b) / b) * 100 : 0;
  if (filter === 'booking_cheaper_gt5')  return pct > 5;
  if (filter === 'booking_cheaper_lte5') return pct > 0 && pct <= 5;
  if (filter === 'booking_cheaper')      return pct > 0;
  if (filter === 'amello_cheaper')       return pct <= 0;
  return true;
}

function sortRateRows(rows: RateRow[], key: BestRateSortKey, dir: SortDir): RateRow[] {
  return [...rows].sort((a, b) => {
    const av = a[key] ?? (dir === 'asc' ? Infinity : -Infinity);
    const bv = b[key] ?? (dir === 'asc' ? Infinity : -Infinity);
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

// ─── pill & row coloring (all-rates) ─────────────────────────────────────────

function allRatesPillProps(a: number | null, b: number | null): { label: string; className: string; style?: React.CSSProperties } {
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

function allRatesBgClass(row: DisplayRow): string {
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

function matchesAllRatesStatus(row: DisplayRow, filter: StatusFilter): boolean {
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

function sortDisplayRows(rows: DisplayRow[], key: AllRatesSortKey, dir: SortDir): DisplayRow[] {
  return [...rows].sort((a, b) => {
    let av: number | string | null, bv: number | string | null;
    if (key === 'check_in_date')  { av = a.check_in_date; bv = b.check_in_date; }
    else if (key === 'price_amello')  { av = a.price_amello; bv = b.price_amello; }
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

// ─── build display rows (all-rates) ──────────────────────────────────────────

function buildDisplayRows(rawRows: RawRow[], mappingsByHotel: Map<number, RoomMapping[]>): DisplayRow[] {
  const amelloIdx = new Map<string, RawRow>();
  const bookingIdx = new Map<string, RawRow>();

  for (const row of rawRows) {
    const date = normalizeDate(row.check_in_date);
    const key = `${row.hotel_id}__${date}__${row.room_name}`;
    if (row.status_amello != null || row.price_amello != null) amelloIdx.set(key, row);
    if (row.status_booking != null || row.price_booking != null || row.price_booking_member != null) bookingIdx.set(key, row);
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

// ─── SortTh ───────────────────────────────────────────────────────────────────

function SortTh<K extends string>({ label, col, sortKey, sortDir, onSort, className }: {
  label: string; col: K; sortKey: K; sortDir: SortDir;
  onSort: (k: K) => void;
  className?: string;
}) {
  const active = sortKey === col;
  return (
    <th
      className={`${className ?? ''} user-select-none`}
      style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
      onClick={() => onSort(col)}
    >
      {label}{' '}
      <i className={`fas fa-sort${active ? (sortDir === 'asc' ? '-up' : '-down') : ''} text-${active ? 'primary' : 'secondary'} small`} />
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
  const [viewMode, setViewMode] = React.useState<ViewMode>('best_rate');

  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);
  const [hotels, setHotels] = React.useState<HotelRow[]>([]);
  const [selectedHotelIds, setSelectedHotelIds] = React.useState<number[]>([]);

  const [scanDetails, setScanDetails] = React.useState<{
    scanId: number; scannedAt: string;
    baseCheckIn: string | null; days: number | null;
    stayNights: number | null; timezone: string | null;
  } | null>(null);

  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');
  const [groupBy, setGroupBy] = React.useState<'none' | 'brand' | 'country' | 'region'>('none');
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set());

  // best-rate state
  const [rateRows, setRateRows] = React.useState<RateRow[]>([]);
  const [rateSort, setRateSort] = React.useState<{ key: BestRateSortKey; dir: SortDir }>({ key: 'check_in_date', dir: 'asc' });

  // all-rates state
  const [rawRows, setRawRows] = React.useState<RawRow[]>([]);
  const [mappingsByHotel, setMappingsByHotel] = React.useState<Map<number, RoomMapping[]>>(new Map());
  const [allRatesSort, setAllRatesSort] = React.useState<{ key: AllRatesSortKey; dir: SortDir }>({ key: 'check_in_date', dir: 'asc' });

  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const toggleGroup = (key: string) =>
    setCollapsedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const handleRateSort = (key: BestRateSortKey) =>
    setRateSort(prev => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }));

  const handleAllRatesSort = (key: AllRatesSortKey) =>
    setAllRatesSort(prev => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }));

  // ── data loading ───────────────────────────────────────────────────────────

  const loadScans = React.useCallback(async () => {
    const list = await fetchJSON('/api/scans', { cache: 'no-store' });
    const arr: ScanRow[] = Array.isArray(list) ? list : [];
    arr.sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());
    setScans(arr);
    if (arr.length > 0) setSelectedScanId(prev => prev ?? arr[0].id);
  }, []);

  const loadHotels = React.useCallback(async () => {
    const list = await fetchJSON('/api/hotels', { cache: 'no-store' });
    const arr: HotelRow[] = Array.isArray(list) ? list : [];
    arr.sort((a, b) => a.name.localeCompare(b.name));
    setHotels(arr);
  }, []);

  const loadScanDetails = React.useCallback(async (scanId: number) => {
    try {
      const d = await fetchJSON(`/api/scans/${scanId}`, { cache: 'no-store' });
      setScanDetails({
        scanId: d.scanId ?? scanId,
        scannedAt: d.scannedAt ?? '',
        baseCheckIn: d.baseCheckIn ?? null,
        days: d.days ?? null,
        stayNights: d.stayNights ?? null,
        timezone: d.timezone ?? null,
      });
    } catch { setScanDetails(null); }
  }, []);

  const loadBestRate = React.useCallback(async (scanId: number, hotelIds: number[]) => {
    const params = new URLSearchParams({ scanID: String(scanId), limit: '5000' });
    if (hotelIds.length > 0) params.append('hotelID', hotelIds.join(','));
    const res = await fetchJSON(`/api/rate-comparison?${params}`, { cache: 'no-store' });
    const rows: RateRow[] = (res.data ?? []).map((r: any) => ({
      ...r,
      amello_min_price:         toNum(r.amello_min_price),
      booking_min_price:        toNum(r.booking_min_price),
      booking_member_min_price: toNum(r.booking_member_min_price),
      price_difference:         toNum(r.price_difference),
      percentage_difference:    toNum(r.percentage_difference),
    }));
    setRateRows(rows);
  }, []);

  const loadAllRates = React.useCallback(async (scanId: number, hotelIds: number[]) => {
    const params = new URLSearchParams({ scanID: String(scanId), format: 'comparison', limit: '1000' });
    if (hotelIds.length > 0) params.append('hotelID', hotelIds.join(','));
    const [res, mappingsData] = await Promise.all([
      fetchJSON(`/api/scan-results?${params}`, { cache: 'no-store' }),
      fetchJSON('/api/room-mappings', { cache: 'no-store' }),
    ]);
    setRawRows(res.data || []);
    const map = new Map<number, RoomMapping[]>();
    for (const h of (mappingsData.hotels ?? [])) map.set(h.id, h.mappings ?? []);
    setMappingsByHotel(map);
  }, []);

  const loadData = React.useCallback(async () => {
    if (!selectedScanId) return;
    setLoading(true);
    setError(null);
    try {
      await Promise.all([
        loadBestRate(selectedScanId, selectedHotelIds),
        loadAllRates(selectedScanId, selectedHotelIds),
      ]);
    } catch (e: any) {
      setError(e.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [selectedScanId, selectedHotelIds, loadBestRate, loadAllRates]);

  React.useEffect(() => { loadScans(); loadHotels(); }, [loadScans, loadHotels]);
  React.useEffect(() => {
    if (selectedScanId) { loadScanDetails(selectedScanId); loadData(); }
  }, [selectedScanId, loadScanDetails, loadData]);

  // ── derived ────────────────────────────────────────────────────────────────

  const hotelMeta = React.useMemo(() => new Map(hotels.map(h => [h.id, h])), [hotels]);

  // best-rate derived
  const filteredRateRows = React.useMemo(
    () => rateRows.filter(r => matchesRateStatus(r, statusFilter)),
    [rateRows, statusFilter],
  );

  const groupedRateByHotel = React.useMemo(() => {
    const map = new Map<number, RateRow[]>();
    for (const row of filteredRateRows) {
      const arr = map.get(row.hotel_id) ?? [];
      arr.push(row);
      map.set(row.hotel_id, arr);
    }
    for (const [id, rows] of map) map.set(id, sortRateRows(rows, rateSort.key, rateSort.dir));
    return map;
  }, [filteredRateRows, rateSort]);

  // all-rates derived
  const displayRows = React.useMemo(
    () => buildDisplayRows(rawRows, mappingsByHotel),
    [rawRows, mappingsByHotel],
  );

  const filteredDisplayRows = React.useMemo(
    () => displayRows.filter(r => matchesAllRatesStatus(r, statusFilter)),
    [displayRows, statusFilter],
  );

  const groupedDisplayByHotel = React.useMemo(() => {
    const map = new Map<number, DisplayRow[]>();
    for (const row of filteredDisplayRows) {
      const arr = map.get(row.hotel_id) ?? [];
      arr.push(row);
      map.set(row.hotel_id, arr);
    }
    for (const [id, rows] of map) map.set(id, sortDisplayRows(rows, allRatesSort.key, allRatesSort.dir));
    return map;
  }, [filteredDisplayRows, allRatesSort]);

  const activeGroupedByHotel = viewMode === 'best_rate' ? groupedRateByHotel : groupedDisplayByHotel;

  const groupedByDimension = React.useMemo(() => {
    if (groupBy === 'none') return null;
    const outer = new Map<string, number[]>();
    for (const [hotelId] of activeGroupedByHotel) {
      const meta = hotelMeta.get(hotelId);
      const label = (meta?.[groupBy] ?? '') || '—';
      const arr = outer.get(label) ?? [];
      arr.push(hotelId);
      outer.set(label, arr);
    }
    return new Map([...outer.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }, [groupBy, activeGroupedByHotel, hotelMeta]);

  // summary (best-rate mode)
  const rateSummary = React.useMemo(() => {
    let amelloOnly = 0, bookingOnly = 0, both = 0, amelloCheaper = 0, bookingCheaper = 0, same = 0;
    let amelloSum = 0, amelloCount = 0, bookingSum = 0, bookingCount = 0, currency = 'EUR';
    for (const r of filteredRateRows) {
      const a = r.amello_min_price, b = r.booking_min_price;
      if (a != null && b != null) {
        both++;
        const pct = b !== 0 ? ((a - b) / b) * 100 : 0;
        if (pct > 0) bookingCheaper++; else if (pct < 0) amelloCheaper++; else same++;
      } else if (a != null) amelloOnly++;
      else if (b != null)   bookingOnly++;
      if (a != null) { amelloSum += a; amelloCount++; if (r.amello_currency) currency = r.amello_currency; }
      if (b != null) { bookingSum += b; bookingCount++; if (r.booking_currency) currency = r.booking_currency; }
    }
    return {
      total: filteredRateRows.length, both, amelloOnly, bookingOnly, amelloCheaper, bookingCheaper, same,
      avgAmello:  amelloCount  > 0 ? formatPrice(amelloSum  / amelloCount,  currency) : null,
      avgBooking: bookingCount > 0 ? formatPrice(bookingSum / bookingCount, currency) : null,
    };
  }, [filteredRateRows]);

  // summary (all-rates mode)
  const allRatesSummary = React.useMemo(() => {
    let amelloOnly = 0, bookingOnly = 0, both = 0, amelloCheaper = 0, bookingCheaper = 0, same = 0;
    let amelloSum = 0, amelloCount = 0, bookingSum = 0, bookingCount = 0, currency = 'EUR';
    for (const r of filteredDisplayRows) {
      const a = r.price_amello, b = r.price_booking;
      if (a != null && b != null) {
        both++;
        const pct = pctDiff(a, b)!;
        if (pct > 0) bookingCheaper++; else if (pct < 0) amelloCheaper++; else same++;
      } else if (a != null) amelloOnly++;
      else if (b != null)   bookingOnly++;
      if (a != null) { amelloSum += a; amelloCount++; currency = r.currency; }
      if (b != null) { bookingSum += b; bookingCount++; currency = r.currency; }
    }
    return {
      total: filteredDisplayRows.length, both, amelloOnly, bookingOnly, amelloCheaper, bookingCheaper, same,
      avgAmello:  amelloCount  > 0 ? formatPrice(amelloSum  / amelloCount,  currency) : null,
      avgBooking: bookingCount > 0 ? formatPrice(bookingSum / bookingCount, currency) : null,
    };
  }, [filteredDisplayRows]);

  const summary = viewMode === 'best_rate' ? rateSummary : allRatesSummary;

  // ── table renderers ────────────────────────────────────────────────────────

  const bestRateTable = (rows: RateRow[]) => (
    <div className="table-responsive border rounded">
      <table className="table table-sm table-striped mb-0">
        <thead className="table-light">
          <tr>
            <SortTh label="Check-In"      col="check_in_date"         sortKey={rateSort.key} sortDir={rateSort.dir} onSort={handleRateSort} />
            <th>Amello Room</th>
            <th>Amello Rate</th>
            <th>Booking Room</th>
            <th>Booking Rate</th>
            <SortTh label="Amello Price"  col="amello_min_price"      sortKey={rateSort.key} sortDir={rateSort.dir} onSort={handleRateSort} className="text-end" />
            <SortTh label="Booking Price" col="booking_min_price"     sortKey={rateSort.key} sortDir={rateSort.dir} onSort={handleRateSort} className="text-end" />
            <th className="text-end text-nowrap">Member Price</th>
            <SortTh label="Diff (A−B)"    col="price_difference"      sortKey={rateSort.key} sortDir={rateSort.dir} onSort={handleRateSort} className="text-end" />
            <th className="text-end text-nowrap">Diff (A−BM)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const a = r.amello_min_price, b = r.booking_min_price, bm = r.booking_member_min_price;
            const currency = r.amello_currency || r.booking_currency || 'EUR';
            const { label, className: pillCls, style: pillStyle } = ratePillProps(r);
            const diffABM = a != null && bm != null ? a - bm : null;
            const diffClsFn = (d: number | null) => d == null ? 'text-muted' : d > 0 ? 'text-danger' : d < 0 ? 'text-success' : 'text-muted';
            return (
              <tr key={i} className={rateBgClass(r)}>
                <td className="text-nowrap">{fmtDate(r.check_in_date)}</td>
                <td className="small">{r.amello_room_name  || <span className="text-muted">—</span>}</td>
                <td className="small">{r.amello_rate_name  || <span className="text-muted">—</span>}</td>
                <td className="small">{r.booking_room_name || <span className="text-muted">—</span>}</td>
                <td className="small">{r.booking_rate_name || <span className="text-muted">—</span>}</td>
                <td className="text-end text-nowrap">{a != null ? formatPrice(a, currency) : <span className="text-muted">—</span>}</td>
                <td className="text-end text-nowrap">{b != null ? formatPrice(b, currency) : <span className="text-muted">—</span>}</td>
                <td className="text-end text-nowrap">
                  {bm != null ? <span className="text-primary fw-semibold">{formatPrice(bm, currency)}</span> : <span className="text-muted">—</span>}
                </td>
                <td className={`text-end fw-bold ${diffClsFn(r.price_difference)}`}>
                  {r.price_difference != null ? (r.price_difference > 0 ? '+' : '') + formatPrice(r.price_difference, currency) : <span className="text-muted">—</span>}
                </td>
                <td className={`text-end fw-bold ${diffClsFn(diffABM)}`}>
                  {diffABM != null ? (diffABM > 0 ? '+' : '') + formatPrice(diffABM, currency) : <span className="text-muted">—</span>}
                </td>
                <td><span className={pillCls} style={pillStyle}>{label}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const allRatesTable = (rows: DisplayRow[]) => (
    <div className="table-responsive border rounded">
      <table className="table table-sm table-striped mb-0">
        <thead className="table-light">
          <tr>
            <SortTh label="Check-In"      col="check_in_date"  sortKey={allRatesSort.key} sortDir={allRatesSort.dir} onSort={handleAllRatesSort} />
            <th>Amello Room</th>
            <th>Booking Room</th>
            <th>Rate</th>
            <SortTh label="Amello Price"  col="price_amello"   sortKey={allRatesSort.key} sortDir={allRatesSort.dir} onSort={handleAllRatesSort} className="text-end" />
            <SortTh label="Booking Price" col="price_booking"  sortKey={allRatesSort.key} sortDir={allRatesSort.dir} onSort={handleAllRatesSort} className="text-end" />
            <th className="text-end text-nowrap">Member Price</th>
            <SortTh label="Diff (A−B)"    col="diff"           sortKey={allRatesSort.key} sortDir={allRatesSort.dir} onSort={handleAllRatesSort} className="text-end" />
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const { label, className: pillCls, style: pillStyle } = allRatesPillProps(r.price_amello, r.price_booking);
            return (
              <tr key={i} className={allRatesBgClass(r)}>
                <td className="text-nowrap">{r.check_in_date}</td>
                <td>{r.amello_room  ?? <span className="text-muted fst-italic">—</span>}</td>
                <td>{r.booking_room ?? <span className="text-muted fst-italic">—</span>}</td>
                <td className="small">{r.rate_name || '—'}</td>
                <td className="text-end text-nowrap">
                  {r.price_amello != null ? formatPrice(r.price_amello, r.currency) : <span className="text-muted">—</span>}
                </td>
                <td className="text-end text-nowrap">
                  {r.price_booking != null ? formatPrice(r.price_booking, r.currency) : <span className="text-muted">—</span>}
                </td>
                <td className="text-end text-nowrap">
                  {r.price_booking_member != null ? <span className="text-primary fw-semibold">{formatPrice(r.price_booking_member, r.currency)}</span> : <span className="text-muted">—</span>}
                </td>
                <DiffCell a={r.price_amello} b={r.price_booking} currency={r.currency} />
                <td><span className={pillCls} style={pillStyle}>{label}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderHotelTable = (hotelId: number) => {
    if (viewMode === 'best_rate') {
      const rows = groupedRateByHotel.get(hotelId);
      return rows ? bestRateTable(rows) : null;
    } else {
      const rows = groupedDisplayByHotel.get(hotelId);
      return rows ? allRatesTable(rows) : null;
    }
  };

  const hotelName = (hotelId: number) => {
    if (viewMode === 'best_rate') return groupedRateByHotel.get(hotelId)?.[0]?.hotel_name ?? '';
    return groupedDisplayByHotel.get(hotelId)?.[0]?.hotel_name ?? '';
  };

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>

        {/* ── view mode toggle ── */}
        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <div className="btn-group" role="group">
            <button
              type="button"
              className={`btn ${viewMode === 'best_rate' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => setViewMode('best_rate')}
            >
              <i className="fas fa-trophy me-2" />Best Rate
            </button>
            <button
              type="button"
              className={`btn ${viewMode === 'all_rates' ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => setViewMode('all_rates')}
            >
              <i className="fas fa-list me-2" />All Rates
            </button>
          </div>
          {viewMode === 'all_rates' && (
            <a href="/room-mappings" className="btn btn-outline-secondary btn-sm">
              <i className="fa fa-sliders me-1" /> Manage Room Mappings
            </a>
          )}
        </div>

        {/* ── controls ── */}
        <div className="d-flex gap-3 mb-3 flex-wrap">
          <select
            className="form-select"
            style={{ minWidth: 300 }}
            value={selectedScanId ?? ''}
            onChange={e => setSelectedScanId(e.target.value ? Number(e.target.value) : null)}
          >
            {scans.map(s => (
              <option key={s.id} value={s.id}>
                #{s.id} • {fmtDateTime(s.scanned_at)} • {s.status}
              </option>
            ))}
          </select>

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

          <select
            className="form-select"
            style={{ maxWidth: 180 }}
            value={groupBy}
            onChange={e => { setGroupBy(e.target.value as typeof groupBy); setCollapsedGroups(new Set()); }}
          >
            <option value="none">No grouping</option>
            <option value="brand">Group by Brand</option>
            <option value="country">Group by Country</option>
            <option value="region">Group by Region</option>
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
              <div className="col-md-4"><strong>Base check-in:</strong> {scanDetails.baseCheckIn ? fmtDate(scanDetails.baseCheckIn) : '—'}</div>
              <div className="col-md-4"><strong>Days scanned:</strong> {scanDetails.days ?? '—'}</div>
              <div className="col-md-4"><strong>Stay nights:</strong> {scanDetails.stayNights ?? '—'}</div>
            </div>
          </div>
        )}

        {/* ── summary ── */}
        {summary.total > 0 && (
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
                  {summary.avgAmello  && <span><strong>Avg Amello:</strong>  {summary.avgAmello}</span>}
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

        {/* ── tables ── */}
        {groupedByDimension
          ? Array.from(groupedByDimension.entries()).map(([groupLabel, hotelIds]) => (
            <div key={groupLabel} className="mb-4">
              <button
                className="btn btn-light border w-100 text-start fw-semibold d-flex justify-content-between align-items-center mb-2 px-3 py-2"
                onClick={() => toggleGroup(groupLabel)}
              >
                <span>{groupLabel} <span className="text-muted fw-normal small ms-1">({hotelIds.length} hotel{hotelIds.length !== 1 ? 's' : ''})</span></span>
                <i className={`fas fa-chevron-${collapsedGroups.has(groupLabel) ? 'down' : 'up'} small`} />
              </button>
              {!collapsedGroups.has(groupLabel) && hotelIds.map(hotelId => (
                <div key={hotelId} className="mb-4 ms-3">
                  <h5 className="mb-2">{hotelName(hotelId)}</h5>
                  {renderHotelTable(hotelId)}
                </div>
              ))}
            </div>
          ))
          : Array.from(activeGroupedByHotel.keys()).map(hotelId => (
            <div key={hotelId} className="mb-5">
              <h4 className="mb-2">{hotelName(hotelId)}</h4>
              {renderHotelTable(hotelId)}
            </div>
          ))
        }

        {!loading && activeGroupedByHotel.size === 0 && !error && (
          <p className="text-muted">No results found for this scan.</p>
        )}
      </div>
    </main>
  );
}
