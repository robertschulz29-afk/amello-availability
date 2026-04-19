'use client';

import * as React from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { fetchJSON } from '@/lib/api-client';

type AvailFilter = 'all' | 'below50' | 'above50';

type Hotel = { id: number; name: string; code: string; brand?: string; region?: string; country?: string; base_image?: string | null };
type ScanRow = {
  id: number; scanned_at: string;
  stay_nights: number; total_cells: number; done_cells: number;
  status: 'queued' | 'running' | 'done' | 'error';
};

type FullSetEntry = {
  scan_id: number;
  hotel_id: number;
  hotel_name: string;
  check_in_date: string;
  status: string;
  source: string;
  response_json: any;
};

type ResultsMatrix = {
  scanId: number;
  scannedAt: string;
  baseCheckIn: string | null;
  days: number | null;
  stayNights: number | null;
  timezone: string | null;
  dates: string[];
  results: Record<string, Record<string, 'green' | 'red'>>;
  prices: Record<string, Record<string, number | null>>;
  fullSet: FullSetEntry[];
};

type PriceRow = {
  date: string;
  hotelName: string;
  roomType: string;
  rateType: string;
  price: number;
  currency: string;
};

function addDaysISO(dateString: string, days: number) {
  const d = new Date(dateString);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDateTime(dt: string) {
  try { return new Date(dt).toLocaleString(); } catch { return dt; }
}

function normalizeDateToYMD(d: string): string {
  const m = String(d ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : d;
}

function deriveFromFullSet(fullSet: FullSetEntry[], hotelsByCode: Map<string, Hotel>) {
  const datesSet = new Set<string>();
  const results: Record<string, Record<string, 'green' | 'red'>> = {};
  const prices: Record<string, Record<string, number | null>> = {};

  const codeById = new Map<number, string>();
  for (const [code, hotel] of hotelsByCode.entries()) {
    codeById.set(hotel.id, code);
  }

  for (const row of fullSet) {
    if (row.source !== 'amello') continue;
    const code = codeById.get(row.hotel_id);
    if (!code) continue;
    const checkIn = normalizeDateToYMD(row.check_in_date);
    datesSet.add(checkIn);
    (results[code] ||= {})[checkIn] = row.status === 'green' ? 'green' : 'red';
    if (row.status === 'green' && row.source === 'amello' && row.response_json) {
      const rooms = row.response_json?.rooms ?? [];
      let lowestPrice: number | null = null;
      for (const room of rooms) {
        for (const rate of room.rates ?? []) {
          if (rate.price != null && (lowestPrice === null || rate.price < lowestPrice)) {
            lowestPrice = rate.price;
          }
        }
      }
      (prices[code] ||= {})[checkIn] = lowestPrice;
    }
  }

  const dates = Array.from(datesSet).sort();
  return { dates, results, prices };
}

function extractPriceRows(fullSet: FullSetEntry[], codes: Set<string>, hotelsByCode: Map<string, Hotel>): PriceRow[] {
  const codeById = new Map<number, string>();
  for (const [code, hotel] of hotelsByCode.entries()) {
    codeById.set(hotel.id, code);
  }

  const bestByDate = new Map<string, PriceRow>();

  for (const entry of fullSet) {
    if (entry.source !== 'amello' || entry.status !== 'green' || !entry.response_json) continue;
    const code = codeById.get(entry.hotel_id);
    if (!code || !codes.has(code)) continue;

    const date = normalizeDateToYMD(entry.check_in_date);
    const rooms = entry.response_json?.rooms ?? [];

    for (const room of rooms) {
      for (const rate of room.rates ?? []) {
        if (rate.price == null) continue;
        const existing = bestByDate.get(date);
        if (!existing || rate.price < existing.price) {
          bestByDate.set(date, {
            date,
            hotelName: entry.hotel_name,
            roomType: room.name ?? '',
            rateType: rate.name ?? '',
            price: rate.price,
            currency: rate.currency ?? 'EUR',
          });
        }
      }
    }
  }

  return Array.from(bestByDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function AvailabilityOverviewTile({ matrix }: { matrix: ResultsMatrix | null }) {
  const stats = React.useMemo(() => {
    if (!matrix || !matrix.results) return null;
    let green = 0; let total = 0;
    for (const hotelResults of Object.values(matrix.results)) {
      for (const result of Object.values(hotelResults)) {
        if (result === 'green') green++;
        if (result === 'green' || result === 'red') total++;
      }
    }
    if (total === 0) return null;
    return { green, total };
  }, [matrix]);

  if (!stats) return null;

  const R = 52; const cx = 72; const cy = 72;
  const circumference = 2 * Math.PI * R;
  const pct = stats.green / stats.total;
  const dash = pct * circumference;
  const gap = circumference - dash;

  return (
    <div className="card mb-3">
      <div className="card-body d-flex align-items-center gap-4 flex-wrap">
        <svg width={144} height={144} viewBox="0 0 144 144">
          <circle cx={cx} cy={cy} r={R} fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth={16} />
          <circle
            cx={cx} cy={cy} r={R} fill="none"
            stroke="#4caf50" strokeWidth={16}
            strokeDasharray={`${dash} ${gap}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
          <text x={cx} y={cy - 6} textAnchor="middle" fontSize="18" fontWeight="bold" fill="currentColor">
            {(pct * 100).toFixed(1)}%
          </text>
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.6">
            available
          </text>
        </svg>
        <div>
          <div className="fw-semibold fs-5">Average Availability</div>
          <div className="text-muted small">{stats.green} of {stats.total} date/hotel combinations available</div>
        </div>
      </div>
    </div>
  );
}

function GroupBarChart({
  title, series, avg, height = 220, barWidth = 14, gap = 6,
}: {
  title: string;
  series: Array<{ date: string; pct: number; greens: number; total: number }>;
  avg: number | null;
  height?: number;
  barWidth?: number;
  gap?: number;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(300);

  React.useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) setContainerWidth(containerRef.current.clientWidth);
    };
    updateWidth();
    let timeoutId: NodeJS.Timeout;
    const debouncedUpdate = () => { clearTimeout(timeoutId); timeoutId = setTimeout(updateWidth, 100); };
    window.addEventListener('resize', debouncedUpdate);
    return () => { clearTimeout(timeoutId); window.removeEventListener('resize', debouncedUpdate); };
  }, []);

  const innerPadTop = 16;
  const labelYOffset = 60;
  const labelGap = 15;
  const innerPadBottom = labelYOffset + labelGap;
  const maxBarArea = height - innerPadTop - innerPadBottom;
  const minWidthForSeries = series.length * (barWidth + gap) + 40;
  const width = Math.max(containerWidth, minWidthForSeries);
  const xStart = 20;
  const averageAvailability = avg !== null ? parseFloat(avg.toFixed(2)) : 0;

  const headerColor = () => {
    if (!isFinite(averageAvailability)) return 'alert-basic';
    if (averageAvailability > 85) return 'alert-green';
    if (averageAvailability > 50) return 'alert-yellow';
    return 'alert-red';
  };

  const yFor = (pct: number) => innerPadTop + (100 - Math.max(0, Math.min(100, pct))) / 100 * maxBarArea;
  const labelEvery = series.length > 120 ? 10 : series.length > 80 ? 6 : series.length > 50 ? 4 : series.length > 25 ? 2 : 1;

  return (
    <div className="card mb-3">
      <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-3">
        <span><strong>{title}</strong></span>
        <p className="mb-0">Average: {averageAvailability}%</p>
      </div>
      <div className="card-body" style={{ overflowX: 'auto' }} ref={containerRef}>
        <svg width={width} height={height} role="img" aria-label={`${title} availability chart`}>
          {[25, 50, 75].map((p) => (
            <g key={`grid-${p}`}>
              <line x1={0} y1={yFor(p)} x2={width} y2={yFor(p)} stroke="currentColor" strokeOpacity="0.1" />
              <text x={4} y={yFor(p) - 2} fontSize="10" fill="currentColor" fillOpacity="0.9">{p}%</text>
            </g>
          ))}
          {series.map((pt, idx) => {
            const x = xStart + idx * (barWidth + gap);
            const y = yFor(pt.pct);
            const h = (innerPadTop + maxBarArea) - y;
            const barColor = (pct: number) => {
              if (!isFinite(pct)) return '#ccc';
              if (pct > 75) return '#4caf50';
              if (pct > 50) return '#ffeb3b';
              return '#f44336';
            };
            return (
              <g key={pt.date}>
                <title>{`${pt.date}: ${isFinite(pt.pct) ? Math.round(pt.pct) : 0}% (${pt.greens}/${pt.total})`}</title>
                <rect x={x} y={y} width={barWidth} height={isFinite(h) ? h : 0} fill={barColor(pt.pct)} fillOpacity="0.25" />
                {idx % labelEvery === 0 && (
                  <text x={x + barWidth / 2} y={height - labelYOffset} textAnchor="start" fontSize="10" fill="currentColor" fillOpacity="0.7" transform={`rotate(45 ${x + barWidth / 2} ${height - labelYOffset})`}>
                    {pt.date}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function GroupHeatmap({
  title, avg, codes, dates, results, hotelsByCode,
}: {
  title: string;
  avg: number | null;
  codes: string[];
  dates: string[];
  results: Record<string, Record<string, 'green' | 'red'>>;
  hotelsByCode: Map<string, Hotel>;
}) {
  const CELL_W = 14;
  const CELL_H = 16;
  const LABEL_W = 200;
  const DATE_LABEL_H = 60;
  const GAP = 1;

  const averageAvailability = avg !== null ? parseFloat(avg.toFixed(2)) : 0;

  const headerColor = () => {
    if (!isFinite(averageAvailability)) return 'alert-basic';
    if (averageAvailability > 85) return 'alert-green';
    if (averageAvailability > 50) return 'alert-yellow';
    return 'alert-red';
  };

  const labelEvery = dates.length > 120 ? 10 : dates.length > 80 ? 6 : dates.length > 50 ? 4 : dates.length > 25 ? 2 : 1;
  const svgWidth = LABEL_W + dates.length * (CELL_W + GAP);
  const svgHeight = DATE_LABEL_H + codes.length * (CELL_H + GAP);

  const cellColor = (code: string, date: string) => {
    const v = results[code]?.[date];
    if (v === 'green') return '#4caf50';
    if (v === 'red') return '#f44336';
    return '#e0e0e0';
  };

  return (
    <div className="card mb-3">
      <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-3">
        <span><strong>{title}</strong></span>
        <p className="mb-0">Average: {averageAvailability}%</p>
      </div>
      <div className="card-body" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '500px' }}>
        <svg width={svgWidth} height={svgHeight}>
          {dates.map((date, dIdx) => {
            if (dIdx % labelEvery !== 0) return null;
            const x = LABEL_W + dIdx * (CELL_W + GAP) + CELL_W / 2;
            return (
              <text key={date} x={x} y={DATE_LABEL_H - 4} fontSize="10" fill="currentColor" fillOpacity="0.7" textAnchor="start" transform={`rotate(-45 ${x} ${DATE_LABEL_H - 4})`}>
                {date}
              </text>
            );
          })}
          {codes.map((code, hIdx) => {
            const hotel = hotelsByCode.get(code);
            const y = DATE_LABEL_H + hIdx * (CELL_H + GAP);
            return (
              <g key={code}>
                <text x={LABEL_W - 4} y={y + CELL_H / 2 + 4} fontSize="11" fill="currentColor" fillOpacity="0.8" textAnchor="end">
                  {hotel?.name ?? code}
                </text>
                {dates.map((date, dIdx) => {
                  const x = LABEL_W + dIdx * (CELL_W + GAP);
                  const v = results[code]?.[date];
                  return (
                    <rect key={date} x={x} y={y} width={CELL_W} height={CELL_H} fill={cellColor(code, date)} fillOpacity={v ? 0.8 : 0.2} rx={2}>
                      <title>{`${hotel?.name ?? code} — ${date}: ${v ?? 'no data'}`}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function PriceTable({ rows }: { rows: PriceRow[] }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="card mb-4">
      <div
        className="card-header d-flex justify-content-between align-items-center"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <span className="fw-semibold">
          Price Data
          {rows.length > 0 && (
            <span className="badge bg-secondary ms-2">{rows.length}</span>
          )}
        </span>
        <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>{open ? '▲ Hide' : '▼ Show'}</span>
      </div>

      {open && (
        <div className="card-body p-0">
          {rows.length === 0 ? (
            <p className="text-muted small m-3">No price data available for this group.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table table-sm table-striped table-hover mb-0">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Hotel</th>
                    <th>Room Type</th>
                    <th>Rate Type</th>
                    <th className="text-end">Lowest Price</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      <td className="text-nowrap">{row.date}</td>
                      <td>{row.hotelName}</td>
                      <td>{row.roomType || '—'}</td>
                      <td>{row.rateType || '—'}</td>
                      <td className="text-end text-nowrap">
                        {row.price.toLocaleString('de-DE', { style: 'currency', currency: row.currency })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PortfolioHealth() {
  const [hotels, setHotels] = React.useState<Hotel[]>([]);
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [matrix, setMatrix] = React.useState<ResultsMatrix | null>(null);
  const [vizMode, setVizMode] = React.useState<'bar' | 'heatmap'>('heatmap');

  const searchParams = useSearchParams();
  const router = useRouter();
  const [availFilter, setAvailFilter] = React.useState<AvailFilter>(
    (searchParams.get('filter') as AvailFilter) ?? 'all'
  );

  function setFilter(f: AvailFilter) {
    setAvailFilter(f);
    const params = new URLSearchParams(window.location.search);
    if (f === 'all') params.delete('filter'); else params.set('filter', f);
    router.replace(`/portfolio-health${params.size ? '?' + params.toString() : ''}`);
  }

  type GroupBy = 'none' | 'hotel' | 'brand' | 'region' | 'country';
  type SortOrder = 'none' | 'asc' | 'desc';

  const [groupBy, setGroupBy] = React.useState<GroupBy>('hotel');
  const [sortOrder, setSortOrder] = React.useState<SortOrder>('none');

  const hotelsByCode = React.useMemo(() => {
    const map = new Map<string, Hotel>();
    for (const h of hotels) map.set(h.code, h);
    return map;
  }, [hotels]);

  const hotelsByCodeRef = React.useRef(hotelsByCode);
  React.useEffect(() => { hotelsByCodeRef.current = hotelsByCode; }, [hotelsByCode]);

  const loadHotels = React.useCallback(async () => {
    try {
      const data = await fetchJSON('/api/hotels', { cache: 'no-store' });
      setHotels(Array.isArray(data) ? data : []);
    } catch (e: any) {}
  }, []);

  const loadScans = React.useCallback(async () => {
    try {
      const list = await fetchJSON('/api/scans', { cache: 'no-store' });
      const arr: ScanRow[] = Array.isArray(list) ? list : [];
      arr.sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());
      setScans(arr);
      setSelectedScanId(prev => prev ?? (arr.length > 0 ? arr[0].id : null));
    } catch (e: any) { setError(e.message || 'Failed to load scans'); }
  }, []);

  const loadScanById = React.useCallback(async (scanId: number) => {
    setLoading(true); setError(null); setMatrix(null);
    try {
      const data = await fetchJSON(`/api/scans/${scanId}`, { cache: 'no-store' });
      const fullSet: FullSetEntry[] = Array.isArray(data?.fullSet) ? data.fullSet : [];
      const { dates, results, prices } = deriveFromFullSet(fullSet, hotelsByCodeRef.current);
      setMatrix({
        scanId,
        scannedAt: String(data?.scannedAt ?? ''),
        baseCheckIn: data?.baseCheckIn ?? null,
        days: data?.days ?? null,
        stayNights: data?.stayNights ?? null,
        timezone: data?.timezone ?? null,
        dates,
        results,
        prices,
        fullSet,
      });
    } catch (e: any) {
      setError(e.message || 'Failed to load scan');
    } finally { setLoading(false); }
  }, []);

  React.useEffect(() => { loadHotels(); loadScans(); }, [loadHotels, loadScans]);
  React.useEffect(() => { if (selectedScanId != null) loadScanById(selectedScanId); }, [selectedScanId, loadScanById]);

  const dates = matrix?.dates ?? [];

  const groups = React.useMemo(() => {
    const gmap = new Map<string, string[]>();
    const byCode = hotelsByCode;
    const allCodes = Object.keys(matrix?.results ?? {});
    const universe = allCodes.length ? allCodes : hotels.map(h => h.code);

    function keyFor(h: Hotel): string {
      if (groupBy === 'hotel') return (h.name && h.name.trim()) || '(no hotel)';
      if (groupBy === 'brand') return (h.brand && h.brand.trim()) || '(no brand)';
      if (groupBy === 'region') return (h.region && h.region.trim()) || '(no region)';
      if (groupBy === 'country') return (h.country && h.country.trim()) || '(no country)';
      return 'All Hotels';
    }

    for (const code of universe) {
      const h = byCode.get(code);
      const label = h ? keyFor(h) : 'All Hotels';
      const arr = gmap.get(label) || [];
      arr.push(code);
      gmap.set(label, arr);
    }

    const out = Array.from(gmap.entries()).map(([label, codes]) => {
      let totalGreens = 0;
      let totalCells = 0;
      codes.forEach(code => {
        const hotelRes = matrix?.results?.[code] || {};
        dates.forEach(d => {
          const val = hotelRes[d];
          if (val === 'green') totalGreens++;
          totalCells++;
        });
      });
      const avg = totalCells > 0 ? (totalGreens / totalCells) * 100 : 0;
      return { label, codes, avg };
    });

    if (sortOrder === 'none') {
      out.sort((a, b) => a.label.localeCompare(b.label));
    } else {
      out.sort((a, b) => sortOrder === 'asc' ? a.avg - b.avg : b.avg - a.avg);
    }

    return out;
  }, [groupBy, sortOrder, hotels, hotelsByCode, matrix, dates]);

  const visibleGroups = React.useMemo(() => {
    if (availFilter === 'below50') return groups.filter(g => g.avg < 50);
    if (availFilter === 'above50') return groups.filter(g => g.avg >= 50);
    return groups;
  }, [groups, availFilter]);

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>
        

        {/* Scan Selection */}
        <div className="mb-3 d-flex gap-2 align-items-center">
          <select className="form-select" style={{ minWidth: 250, maxWidth: '100%' }} value={selectedScanId ?? ''} onChange={e => setSelectedScanId(Number(e.target.value))}>
            {scans.length === 0 ? <option value="">No scans</option> : scans.map(s => (
              <option key={s.id} value={s.id}>
                #{s.id} • {fmtDateTime(s.scanned_at)} • {s.status} ({s.done_cells}/{s.total_cells})
              </option>
            ))}
          </select>
        </div>

        {/* Scan Parameters */}
        {matrix && (
          <div className="card mb-3">
            <div className="card-header">Scan Parameters</div>
            <div className="card-body small">
              <div className="row g-2">
                <div className="col-sm-6 col-md-3"><strong>Scan Date:</strong> {fmtDateTime(matrix.scannedAt)}</div>
                <div className="col-sm-6 col-md-3"><strong>Check-in Date:</strong>{matrix.baseCheckIn ? (`${matrix.baseCheckIn} to ${addDaysISO(matrix.baseCheckIn, (matrix.days ?? 0) - 1)}`) : ('—')}</div>
                <div className="col-sm-6 col-md-3"><strong>Days Scanned:</strong> {matrix.days ?? '—'}</div>
                <div className="col-sm-6 col-md-3"><strong>Stay (nights):</strong> {matrix.stayNights ?? '—'}</div>
              </div>
            </div>
          </div>
        )}

        <AvailabilityOverviewTile matrix={matrix} />

        {/* Controls */}
        <div className="d-flex flex-wrap gap-3 align-items-center mb-4">
          <div className="d-flex align-items-center gap-2">
            <label className="form-label mb-0 fw-bold text-nowrap">Group by:</label>
            <select className="form-select" value={groupBy} onChange={e => setGroupBy(e.target.value as any)}>
              <option value="none">None</option>
              <option value="hotel">Hotel</option>
              <option value="brand">Brand</option>
              <option value="region">Region</option>
              <option value="country">Country</option>
            </select>
          </div>
          <div className="d-flex align-items-center gap-2">
            <label className="form-label mb-0 fw-bold text-nowrap">Sort by Avg. Availability:</label>
            <select className="form-select" value={sortOrder} onChange={e => setSortOrder(e.target.value as any)}>
              <option value="none">None (Alphabetical)</option>
              <option value="asc">Ascending (Low to High)</option>
              <option value="desc">Descending (High to Low)</option>
            </select>
          </div>
          <div className="d-flex align-items-center gap-2">
            <button
              className="btn btn-outline-secondary btn-sm"
              onClick={() => {
                const rows = [['Group', 'Avg Availability (%)']];
                for (const g of visibleGroups) rows.push([g.label, g.avg.toFixed(2)]);
                const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
                a.download = `portfolio-health-${availFilter}.csv`;
                a.click();
              }}
              disabled={visibleGroups.length === 0}
            >
              <i className="fas fa-download me-1" />Export CSV
            </button>
          </div>
          <div className="d-flex align-items-center gap-2">
            <label className="form-label mb-0 fw-bold text-nowrap">Availability:</label>
            <div className="btn-group">
              <button type="button" className={`btn ${availFilter === 'all' ? 'btn-secondary' : 'btn-outline-secondary'}`} onClick={() => setFilter('all')}>All</button>
              <button type="button" className={`btn ${availFilter === 'above50' ? 'btn-secondary' : 'btn-outline-secondary'}`} onClick={() => setFilter('above50')}>≥ 50%</button>
              <button type="button" className={`btn ${availFilter === 'below50' ? 'btn-secondary' : 'btn-outline-secondary'}`} onClick={() => setFilter('below50')}>&lt; 50%</button>
            </div>
          </div>
          <div className="d-flex align-items-center gap-2">
            <label className="form-label mb-0 fw-bold text-nowrap">Visualization:</label>
            <div className="btn-group">
              <button type="button" className={`btn ${vizMode === 'heatmap' ? 'btn-secondary' : 'btn-outline-secondary'}`} onClick={() => setVizMode('heatmap')}>
                Heatmap
              </button>
              <button type="button" className={`btn ${vizMode === 'bar' ? 'btn-secondary' : 'btn-outline-secondary'}`} onClick={() => setVizMode('bar')}>
                Bar Chart
              </button>
            </div>
          </div>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        {loading ? (
          <div className="text-center my-5">
            <div className="spinner-border text-primary" role="status"><span className="visually-hidden">Loading...</span></div>
            <div className="mt-2 text-muted">Loading scan data...</div>
          </div>
        ) : null}

        <div className={groupBy === 'none' ? 'ungroupedList' : 'hotelList'}>
          {!loading && dates.length > 0 && visibleGroups.length > 0 ? (
            <>
              {visibleGroups.map(g => {
                const priceRows = extractPriceRows(
                  matrix?.fullSet ?? [],
                  new Set(g.codes),
                  hotelsByCode,
                );

                const hotelForHeader = groupBy === 'hotel' ? hotelsByCode.get(g.codes[0]) : null;

                return (
                  <div key={g.label} className="mb-4 hotelListCard">

                    {hotelForHeader && (
                      <div className="hotelListCardImageContainer mb-2">
                        {hotelForHeader.base_image && (
                          <img
                            src={hotelForHeader.base_image}
                            alt={hotelForHeader.name}
                            className="hotelListCardImageContainerImage"
                          />
                        )}
                        <div className="hotelListCardImageContainerName">{hotelForHeader.name}</div>
                      </div>
                    )}

                    {vizMode === 'bar' ? (
                      <GroupBarChart
                        title={g.label}
                        series={dates.map(d => {
                          let greens = 0, total = 0;
                          for (const code of g.codes) {
                            const v = matrix?.results?.[code]?.[d];
                            if (v === 'green') { greens++; total++; }
                            else { total++; }
                          }
                          const pct = total > 0 ? (greens / total) * 100 : 0;
                          return { date: d, pct, greens, total };
                        })}
                        avg={g.avg}
                        height={220}
                        barWidth={12}
                        gap={5}
                      />
                    ) : (
                      <GroupHeatmap
                        title={g.label}
                        avg={g.avg}
                        codes={g.codes}
                        dates={dates}
                        results={matrix?.results ?? {}}
                        hotelsByCode={hotelsByCode}
                      />
                    )}

                    <PriceTable rows={priceRows} />
                  </div>
                );
              })}
            </>
          ) : (
            !loading && <p className="text-muted">No results found for this scan.</p>
          )}
        </div>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <React.Suspense fallback={null}>
      <PortfolioHealth />
    </React.Suspense>
  );
}
