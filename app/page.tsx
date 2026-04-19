'use client';

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';

type ScanRow = {
  id: number;
  scanned_at: string;
  stay_nights: number;
  total_cells: number;
  done_cells: number;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  base_checkin?: string | null;
  days?: number | null;
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

type RawRow = {
  hotel_id: number; hotel_name: string; check_in_date: string; room_name: string;
  price_amello: string | null; price_booking: string | null;
  status_amello: 'green' | 'red' | null; status_booking: 'green' | 'red' | null;
};
type Mapping = { id: number; hotel_id: number; amello_room: string; booking_room: string };

function fmtDateTime(dt: string) {
  try { return new Date(dt).toLocaleString(); } catch { return dt; }
}

// ── Donut chart ───────────────────────────────────────────────────────────────

function DonutChart({
  value, total, color = '#4caf50', label,
}: {
  value: number; total: number; color?: string; label: string;
}) {
  const R = 40;
  const cx = 60; const cy = 60;
  const circumference = 2 * Math.PI * R;
  const pct = total > 0 ? value / total : 0;
  const dash = pct * circumference;
  const gap = circumference - dash;

  return (
    <div className="d-flex flex-column align-items-center">
      <svg width={120} height={120} viewBox="0 0 120 120">
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth={14} />
        <circle
          cx={cx} cy={cy} r={R}
          fill="none"
          stroke={color}
          strokeWidth={14}
          strokeDasharray={`${dash} ${gap}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="14" fontWeight="bold" fill="currentColor">
          {total > 0 ? `${Math.round(pct * 100)}%` : '—'}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.6">
          {value}/{total}
        </text>
      </svg>
      <div className="small text-muted mt-1">{label}</div>
    </div>
  );
}

// ── Availability computation (deduped by hotel+date) ─────────────────────────

function computeAvailability(fullSet: FullSetEntry[]): { green: number; total: number } | null {
  const deduped = new Map<string, 'green' | 'red'>();
  for (const row of fullSet) {
    if (row.source !== 'amello') continue;
    const key = `${row.hotel_id}__${String(row.check_in_date).slice(0, 10)}`;
    deduped.set(key, row.status === 'green' ? 'green' : 'red');
  }
  if (deduped.size === 0) return null;
  let green = 0;
  for (const v of deduped.values()) if (v === 'green') green++;
  return { green, total: deduped.size };
}

// ── Pricing conflicts ─────────────────────────────────────────────────────────

function toNum(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function normalizeDate(d: string): string {
  const m = String(d).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : d;
}

async function fetchPricingConflicts(scanId: number): Promise<{ cheaper: number; total: number }> {
  const [res, mappingsData] = await Promise.all([
    fetchJSON(`/api/scan-results?scanID=${scanId}&format=comparison&limit=5000`, { cache: 'no-store' }),
    fetchJSON('/api/room-mappings', { cache: 'no-store' }),
  ]);

  const rawRows: RawRow[] = res?.data ?? [];
  const mappingsByHotel = new Map<number, Mapping[]>();
  for (const h of (mappingsData?.hotels ?? [])) mappingsByHotel.set(h.id, h.mappings ?? []);

  const amelloIdx = new Map<string, RawRow>();
  const bookingIdx = new Map<string, RawRow>();
  for (const row of rawRows) {
    const date = normalizeDate(row.check_in_date);
    const key = `${row.hotel_id}__${date}__${row.room_name}`;
    if (row.price_amello != null || row.status_amello != null) amelloIdx.set(key, row);
    if (row.price_booking != null || row.status_booking != null) bookingIdx.set(key, row);
  }

  let cheaper = 0; let total = 0;
  const hotelDates = new Set(rawRows.map(r => `${r.hotel_id}__${normalizeDate(r.check_in_date)}`));

  for (const hd of hotelDates) {
    const [hIdStr, date] = hd.split('__');
    const hotelId = Number(hIdStr);
    for (const m of (mappingsByHotel.get(hotelId) ?? [])) {
      const aRow = amelloIdx.get(`${hotelId}__${date}__${m.amello_room}`);
      const bRow = bookingIdx.get(`${hotelId}__${date}__${m.booking_room}`);
      if (!aRow || !bRow) continue;
      const aPrice = toNum(aRow.price_amello);
      const bPrice = toNum(bRow.price_booking);
      if (aPrice == null || bPrice == null) continue;
      total++;
      if (bPrice < aPrice) cheaper++;
    }
  }

  return { cheaper, total };
}

// ── Scan source counts ────────────────────────────────────────────────────────

function computeSourceCounts(fullSet: FullSetEntry[]) {
  let amelloGreen = 0; let amelloTotal = 0;
  let bookingGreen = 0; let bookingTotal = 0;
  for (const row of fullSet) {
    if (row.source === 'amello') { amelloTotal++; if (row.status === 'green') amelloGreen++; }
    else if (row.source === 'booking') { bookingTotal++; if (row.status === 'green') bookingGreen++; }
  }
  return { amelloGreen, amelloTotal, bookingGreen, bookingTotal };
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Page() {
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);
  const [fullSet, setFullSet] = React.useState<FullSetEntry[]>([]);
  const [pricingConflicts, setPricingConflicts] = React.useState<{ cheaper: number; total: number } | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    fetchJSON('/api/scans', { cache: 'no-store' })
      .then((list: ScanRow[]) => {
        const arr = Array.isArray(list) ? list : [];
        arr.sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());
        setScans(arr);
        if (arr.length > 0) setSelectedScanId(arr[0].id);
      })
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    if (selectedScanId == null) return;
    setLoading(true);
    setPricingConflicts(null);
    setFullSet([]);

    fetchJSON(`/api/scans/${selectedScanId}`, { cache: 'no-store' })
      .then(data => {
        const fs: FullSetEntry[] = Array.isArray(data?.fullSet) ? data.fullSet : [];
        setFullSet(fs);
        return fetchPricingConflicts(selectedScanId);
      })
      .then(pc => setPricingConflicts(pc))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedScanId]);

  const selectedScan = scans.find(s => s.id === selectedScanId);
  const avail = React.useMemo(() => computeAvailability(fullSet), [fullSet]);
  const src = React.useMemo(() => computeSourceCounts(fullSet), [fullSet]);
  const uniqueHotels = React.useMemo(() => new Set(fullSet.map(r => r.hotel_id)).size, [fullSet]);

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>

        {/* Scan selector */}
        <div className="mb-4 d-flex gap-2 align-items-center">
          <select
            className="form-select"
            style={{ maxWidth: 380 }}
            value={selectedScanId ?? ''}
            onChange={e => setSelectedScanId(Number(e.target.value))}
          >
            {scans.length === 0
              ? <option value="">No scans</option>
              : scans.map(s => (
                <option key={s.id} value={s.id}>
                  #{s.id} · {fmtDateTime(s.scanned_at)} · {s.status}
                </option>
              ))}
          </select>
        </div>

        {loading && (
          <div className="text-center my-5">
            <div className="spinner-border" role="status" />
          </div>
        )}

        {!loading && selectedScan && (
          <div className="row g-3">

            {/* ── Scan Info ── */}
            <div className="col-md-6 col-lg-3">
              <div className="card h-100">
                <div className="card-header fw-semibold">Scan Info</div>
                <div className="card-body small">
                  <div><strong>Date:</strong> {fmtDateTime(selectedScan.scanned_at)}</div>
                  <div><strong>Status:</strong> {selectedScan.status}</div>
                  <div><strong>Hotels:</strong> {uniqueHotels}</div>
                  <div><strong>Days scanned:</strong> {selectedScan.days ?? '—'}</div>
                  <div><strong>Stay (nights):</strong> {selectedScan.stay_nights}</div>
                  <div><strong>Items scanned:</strong> {selectedScan.done_cells} / {selectedScan.total_cells}</div>
                  {selectedScan.base_checkin && (
                    <div><strong>Check-in from:</strong> {selectedScan.base_checkin}</div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Source Counts ── */}
            <div className="col-md-6 col-lg-3">
              <div className="card h-100">
                <div className="card-header fw-semibold">Scan Sources</div>
                <div className="card-body d-flex justify-content-around align-items-center">
                  <DonutChart
                    value={src.amelloGreen}
                    total={src.amelloTotal}
                    color="#0d6efd"
                    label="Amello"
                  />
                  <DonutChart
                    value={src.bookingGreen}
                    total={src.bookingTotal}
                    color="#6f42c1"
                    label="Booking"
                  />
                </div>
                <div className="card-footer small text-muted text-center">
                  {src.amelloTotal} amello · {src.bookingTotal} booking.com scans
                </div>
              </div>
            </div>

            {/* ── Portfolio Health ── */}
            <div className="col-md-6 col-lg-3">
              <div className="card h-100">
                <div className="card-header fw-semibold">Portfolio Health</div>
                <div className="card-body d-flex flex-column align-items-center justify-content-center">
                  {avail ? (
                    <DonutChart
                      value={avail.green}
                      total={avail.total}
                      color="#4caf50"
                      label="Available"
                    />
                  ) : <span className="text-muted">No data</span>}
                </div>
                <div className="card-footer d-flex justify-content-center">
                  <a
                    href="/portfolio-health?filter=below50"
                    className="btn btn-sm btn-outline-secondary"
                  >
                    View problems (&lt; 50%)
                  </a>
                </div>
              </div>
            </div>

            {/* ── Pricing Conflicts ── */}
            <div className="col-md-6 col-lg-3">
              <div className="card h-100">
                <div className="card-header fw-semibold">Pricing Conflicts</div>
                <div className="card-body d-flex flex-column align-items-center justify-content-center">
                  {pricingConflicts ? (
                    <DonutChart
                      value={pricingConflicts.cheaper}
                      total={pricingConflicts.total}
                      color="#f44336"
                      label="Booking cheaper"
                    />
                  ) : <span className="text-muted">No data</span>}
                </div>
                <div className="card-footer d-flex justify-content-center">
                  <a
                    href={`/price-comparison?scanId=${selectedScanId}&filter=booking_cheaper`}
                    className="btn btn-sm btn-outline-secondary"
                  >
                    View conflicts
                  </a>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </main>
  );
}
