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

type HotelRow = { id: number; name: string; code: string; brand?: string; country?: string; region?: string };

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
  booking_currency: string | null;
  booking_room_name: string | null;
  booking_rate_name: string | null;
  price_difference: number | null;      // amello − booking
  percentage_difference: number | null; // (amello − booking) / booking × 100
};

type SortKey = 'check_in_date' | 'amello_min_price' | 'booking_min_price' | 'price_difference' | 'percentage_difference';
type SortDir = 'asc' | 'desc';
type StatusFilter = 'all' | 'amello_only' | 'booking_only' | 'booking_cheaper_gt5' | 'booking_cheaper_lte5' | 'amello_cheaper';

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(dt: string) {
  try { return new Date(dt).toLocaleString(); } catch { return dt; }
}
function fmtDate(dt: string) {
  try { return new Date(dt).toLocaleDateString(); } catch { return dt; }
}
function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// ─── pill & row coloring (same logic as price-comparison) ────────────────────

function pillProps(a: number | null, b: number | null): { label: string; className: string; style?: React.CSSProperties } {
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

function rowBgClass(a: number | null, b: number | null): string {
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

function matchesStatusFilter(row: RateRow, filter: StatusFilter): boolean {
  const a = row.amello_min_price;
  const b = row.booking_min_price;
  if (filter === 'all') return true;
  if (filter === 'amello_only')        return a != null && b == null;
  if (filter === 'booking_only')       return a == null && b != null;
  if (a == null || b == null) return false;
  const pct = b !== 0 ? ((a - b) / b) * 100 : 0;
  if (filter === 'booking_cheaper_gt5')  return pct > 5;
  if (filter === 'booking_cheaper_lte5') return pct > 0 && pct <= 5;
  if (filter === 'amello_cheaper')       return pct <= 0;
  return true;
}

// ─── sort helpers ─────────────────────────────────────────────────────────────

function sortRows(rows: RateRow[], key: SortKey, dir: SortDir): RateRow[] {
  return [...rows].sort((a, b) => {
    const av = a[key] ?? (dir === 'asc' ? Infinity : -Infinity);
    const bv = b[key] ?? (dir === 'asc' ? Infinity : -Infinity);
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
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

  const [allRows, setAllRows] = React.useState<RateRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  // ── sort & filter state ──────────────────────────────────────────────────
  const [sort, setSort] = React.useState<{ key: SortKey; dir: SortDir }>({ key: 'check_in_date', dir: 'asc' });
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');
  const [groupBy, setGroupBy] = React.useState<'none' | 'brand' | 'country' | 'region'>('none');
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set());

  const toggleGroup = (key: string) =>
    setCollapsedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const handleSort = (key: SortKey) =>
    setSort(prev => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }));

  // ── data loading ──────────────────────────────────────────────────────────

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

  const loadData = React.useCallback(async () => {
    if (!selectedScanId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ scanID: String(selectedScanId), limit: '5000' });
      if (selectedHotelId) params.append('hotelID', String(selectedHotelId));
      const res = await fetchJSON(`/api/rate-comparison?${params}`, { cache: 'no-store' });
      const rows: RateRow[] = (res.data ?? []).map((r: any) => ({
        ...r,
        amello_min_price:    toNum(r.amello_min_price),
        booking_min_price:   toNum(r.booking_min_price),
        price_difference:    toNum(r.price_difference),
        percentage_difference: toNum(r.percentage_difference),
      }));
      setAllRows(rows);
    } catch (e: any) {
      setError(e.message || 'Failed to load data');
      setAllRows([]);
    } finally {
      setLoading(false);
    }
  }, [selectedScanId, selectedHotelId]);

  React.useEffect(() => { loadScans(); loadHotels(); }, [loadScans, loadHotels]);
  React.useEffect(() => {
    if (selectedScanId) { loadScanDetails(selectedScanId); loadData(); }
  }, [selectedScanId, selectedHotelId, loadScanDetails, loadData]);

  // ── derived data ──────────────────────────────────────────────────────────

  const hotelMeta = React.useMemo(() =>
    new Map(hotels.map(h => [h.id, h])),
  [hotels]);

  const filteredHotels = React.useMemo(() => {
    if (!hotelSearchTerm.trim()) return hotels;
    const t = hotelSearchTerm.toLowerCase();
    return hotels.filter(h => h.name.toLowerCase().includes(t) || h.code.toLowerCase().includes(t));
  }, [hotels, hotelSearchTerm]);

  const filteredRows = React.useMemo(
    () => allRows.filter(r => matchesStatusFilter(r, statusFilter)),
    [allRows, statusFilter]
  );

  const groupedByHotel = React.useMemo(() => {
    const map = new Map<number, RateRow[]>();
    for (const row of filteredRows) {
      const arr = map.get(row.hotel_id) ?? [];
      arr.push(row);
      map.set(row.hotel_id, arr);
    }
    // sort each hotel's rows
    for (const [id, rows] of map) map.set(id, sortRows(rows, sort.key, sort.dir));
    return map;
  }, [filteredRows, sort]);

  // outer grouping by brand / country / region
  const groupedByDimension = React.useMemo(() => {
    if (groupBy === 'none') return null;
    const outer = new Map<string, number[]>(); // groupLabel → hotelIds
    for (const [hotelId] of groupedByHotel) {
      const meta = hotelMeta.get(hotelId);
      const label = (meta?.[groupBy] ?? '') || '—';
      const arr = outer.get(label) ?? [];
      arr.push(hotelId);
      outer.set(label, arr);
    }
    return new Map([...outer.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }, [groupBy, groupedByHotel, hotelMeta]);

  const summary = React.useMemo(() => {
    let amelloOnly = 0, bookingOnly = 0, both = 0, amelloCheaper = 0, bookingCheaper = 0, same = 0;
    let amelloSum = 0, amelloCount = 0, bookingSum = 0, bookingCount = 0, currency = 'EUR';
    for (const r of filteredRows) {
      const a = r.amello_min_price, b = r.booking_min_price;
      if (a != null && b != null) {
        both++;
        const pct = b !== 0 ? ((a - b) / b) * 100 : 0;
        if (pct > 0) bookingCheaper++; else if (pct < 0) amelloCheaper++; else same++;
      } else if (a != null) { amelloOnly++; }
      else if (b != null)   { bookingOnly++; }
      if (a != null) { amelloSum += a; amelloCount++; if (r.amello_currency) currency = r.amello_currency; }
      if (b != null) { bookingSum += b; bookingCount++; if (r.booking_currency) currency = r.booking_currency; }
    }
    return {
      total: filteredRows.length, both, amelloOnly, bookingOnly,
      amelloCheaper, bookingCheaper, same,
      avgAmello:  amelloCount  > 0 ? formatPrice(amelloSum  / amelloCount,  currency) : null,
      avgBooking: bookingCount > 0 ? formatPrice(bookingSum / bookingCount, currency) : null,
    };
  }, [filteredRows]);

  // ── render ────────────────────────────────────────────────────────────────

  const hotelTable = (rows: RateRow[]) => (
    <div className="table-responsive border rounded">
      <table className="table table-sm table-striped mb-0">
        <thead className="table-light">
          <tr>
            <SortTh label="Check-In"   col="check_in_date"         sort={sort} onSort={handleSort} />
            <th>Amello Room</th>
            <th>Amello Rate</th>
            <SortTh label="Amello Price"    col="amello_min_price"    sort={sort} onSort={handleSort} className="text-end" />
            <th>Booking Room</th>
            <th>Booking Rate</th>
            <SortTh label="Booking Price"   col="booking_min_price"   sort={sort} onSort={handleSort} className="text-end" />
            <SortTh label="Diff (A−B)"      col="price_difference"    sort={sort} onSort={handleSort} className="text-end" />
            <SortTh label="% Diff"          col="percentage_difference" sort={sort} onSort={handleSort} className="text-end" />
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const a = r.amello_min_price;
            const b = r.booking_min_price;
            const currency = r.amello_currency || r.booking_currency || 'EUR';
            const { label, className: pillCls, style: pillStyle } = pillProps(a, b);
            const diffCls = r.price_difference == null ? 'text-muted'
              : r.price_difference > 0 ? 'text-danger'
              : r.price_difference < 0 ? 'text-success'
              : 'text-muted';
            return (
              <tr key={i} className={rowBgClass(a, b)}>
                <td className="text-nowrap">{fmtDate(r.check_in_date)}</td>
                <td className="small">{r.amello_room_name  || <span className="text-muted">—</span>}</td>
                <td className="small">{r.amello_rate_name  || <span className="text-muted">—</span>}</td>
                <td className="text-end text-nowrap">{a != null ? formatPrice(a, currency) : <span className="text-muted">—</span>}</td>
                <td className="small">{r.booking_room_name || <span className="text-muted">—</span>}</td>
                <td className="small">{r.booking_rate_name || <span className="text-muted">—</span>}</td>
                <td className="text-end text-nowrap">{b != null ? formatPrice(b, currency) : <span className="text-muted">—</span>}</td>
                <td className={`text-end fw-bold ${diffCls}`}>
                  {r.price_difference != null ? (r.price_difference > 0 ? '+' : '') + formatPrice(r.price_difference, currency) : <span className="text-muted">—</span>}
                </td>
                <td className={`text-end fw-bold ${diffCls}`}>
                  {r.percentage_difference != null ? (r.percentage_difference > 0 ? '+' : '') + r.percentage_difference.toFixed(1) + '%' : <span className="text-muted">—</span>}
                </td>
                <td><span className={pillCls} style={pillStyle}>{label}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>

        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <h1 className="h3 mb-0">Best Available Rate</h1>
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

          <select className="form-select" style={{ maxWidth: 180 }} value={groupBy} onChange={e => { setGroupBy(e.target.value as typeof groupBy); setCollapsedGroups(new Set()); }}>
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
                  {summary.avgAmello && <span><strong>Avg Amello:</strong> {summary.avgAmello}</span>}
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

        {/* ── tables grouped by hotel (optionally wrapped in dimension groups) ── */}
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
              {!collapsedGroups.has(groupLabel) && hotelIds.map(hotelId => {
                const rows = groupedByHotel.get(hotelId)!;
                return (
                  <div key={hotelId} className="mb-4 ms-3">
                    <h5 className="mb-2">{rows[0].hotel_name}</h5>
                    {hotelTable(rows)}
                  </div>
                );
              })}
            </div>
          ))
          : Array.from(groupedByHotel.entries()).map(([hotelId, rows]) => (
            <div key={hotelId} className="mb-5">
              <h4 className="mb-2">{rows[0].hotel_name}</h4>
              {hotelTable(rows)}
            </div>
          ))
        }

        {!loading && groupedByHotel.size === 0 && !error && (
          <p className="text-muted">No results found for this scan.</p>
        )}
      </div>
    </main>
  );
}
