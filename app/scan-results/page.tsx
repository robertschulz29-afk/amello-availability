// app/scan-results/page.tsx
'use client';

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';
import { extractLowestPrice, formatPrice } from '@/lib/price-utils';
import { HotelCombobox } from '@/app/components/HotelCombobox';
import { PaginationBar } from '@/app/components/PaginationBar';
import { ScanInfoCard, ScanDetails } from '@/app/components/ScanInfoCard';

type ScanRow = {
  id: number;
  scanned_at: string;
  stay_nights: number;
  total_cells: number;
  done_cells: number;
  status: 'queued' | 'running' | 'done' | 'error';
};

type HotelRow = { id: number; name: string; code: string; brand?: string; booking_url?: string | null; tuiamello_url?: string | null; };

type ScanResult = {
  scan_id: number;
  hotel_id: number;
  hotel_name?: string;
  booking_url?: string | null;
  tuiamello_url?: string | null;
  check_in_date: string;
  status: 'green' | 'red';
  response_json: any;
  source?: string;
};

type PaginatedResponse = {
  data: ScanResult[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

function addDaysUTC(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function toYMD(val: any): string {
  if (!val) return '';
  const s = String(val);
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function buildSourceUrl(result: ScanResult, stayNights: number): string | null {
  if (result.source === 'booking' || result.source === 'booking_member') {
    const raw = result.booking_url;
    if (!raw) return null;
    const checkIn = toYMD(result.check_in_date);
    if (!checkIn) return null;
    try {
      const base = raw.startsWith('http') ? raw : `https://www.booking.com${raw}`;
      const u = new URL(base);
      u.searchParams.set('checkin', checkIn);
      u.searchParams.set('checkout', addDaysUTC(checkIn, stayNights));
      u.searchParams.set('group_adults', '2');
      u.searchParams.set('group_children', '0');
      return u.toString();
    } catch { return null; }
  }
  if (result.source === 'amello') return result.tuiamello_url ?? null;
  return null;
}

function getSourceDisplay(source?: string) {
  if (source === 'booking')        return { label: 'Booking (Standard)', badgeClass: 'bg-info' };
  if (source === 'booking_member') return { label: 'Booking (Member)',   badgeClass: 'bg-primary' };
  if (source === 'amello')         return { label: 'Amello',             badgeClass: 'bg-secondary' };
  return { label: source || '—', badgeClass: 'bg-secondary' };
}

export default function Page() {
  const [scans, setScans]                   = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);
  const [scanDetails, setScanDetails]       = React.useState<ScanDetails | null>(null);

  const [hotels, setHotels]                   = React.useState<HotelRow[]>([]);
  const [selectedHotelIds, setSelectedHotelIds] = React.useState<number[]>([]);

  const [selectedCheckInDate, setSelectedCheckInDate] = React.useState<string>('');
  const [selectedSource, setSelectedSource]           = React.useState<string>('');

  const [results, setResults]       = React.useState<ScanResult[]>([]);
  const [page, setPage]             = React.useState(1);
  const [limit, setLimit]           = React.useState(100);
  const [total, setTotal]           = React.useState(0);
  const [totalPages, setTotalPages] = React.useState(0);
  const [error, setError]           = React.useState<string | null>(null);
  const [initialLoading, setInitialLoading] = React.useState(true);
  const [reloading, setReloading]           = React.useState(false);

  const fetchResults = React.useCallback(async (
    scanId: number, pg: number, lim: number,
    hotelIds: number[], checkIn: string, source: string,
  ): Promise<PaginatedResponse> => {
    const params = new URLSearchParams({ scanID: scanId.toString(), page: pg.toString(), limit: lim.toString() });
    if (hotelIds.length > 0) params.append('hotelID', hotelIds.join(','));
    if (checkIn)  params.append('checkInDate', checkIn);
    if (source)   params.append('source', source);
    return fetchJSON(`/api/scan-results?${params}`, { cache: 'no-store' });
  }, []);

  // Initial load: scans + hotels + first results all at once
  React.useEffect(() => {
    (async () => {
      try {
        const [scanList, hotelList] = await Promise.all([
          fetchJSON('/api/scans', { cache: 'no-store' }),
          fetchJSON('/api/hotels?slim=1&active=1&bookable=1', { cache: 'no-store' }),
        ]);
        const scansArr: ScanRow[] = Array.isArray(scanList) ? scanList : [];
        scansArr.sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());
        const hotelsArr: HotelRow[] = Array.isArray(hotelList) ? hotelList : [];
        hotelsArr.sort((a, b) => a.name.localeCompare(b.name));
        setScans(scansArr);
        setHotels(hotelsArr);

        if (scansArr.length > 0) {
          const firstId = scansArr[0].id;
          setSelectedScanId(firstId);
          const [details, resultsData] = await Promise.all([
            fetchJSON(`/api/scans/${firstId}?meta=1`, { cache: 'no-store' }).catch(() => null),
            fetchResults(firstId, 1, 100, [], '', '').catch(() => null),
          ]);
          if (details) setScanDetails({
            scanId: details.scanId ?? firstId,
            scannedAt: details.scannedAt ?? '',
            baseCheckIn: details.baseCheckIn ?? null,
            days: details.days ?? null,
            stayNights: details.stayNights ?? null,
            timezone: details.timezone ?? null,
            hotelTotal: details.hotelTotal ?? null,
            hotelBookableActive: details.hotelBookableActive ?? null,
          });
          if (resultsData) {
            setResults(resultsData.data || []);
            setTotal(resultsData.total || 0);
            setTotalPages(resultsData.totalPages || 0);
          }
        }
      } catch (e: any) { setError(e.message || 'Failed to load'); }
      finally { setInitialLoading(false); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload when scan changes (after initial load)
  const handleScanChange = React.useCallback(async (scanId: number | null) => {
    setSelectedScanId(scanId);
    setSelectedHotelIds([]);
    setSelectedCheckInDate('');
    setSelectedSource('');
    setPage(1);
    if (!scanId) { setScanDetails(null); setResults([]); setTotal(0); setTotalPages(0); return; }
    setReloading(true);
    setError(null);
    try {
      const [details, resultsData] = await Promise.all([
        fetchJSON(`/api/scans/${scanId}?meta=1`, { cache: 'no-store' }).catch(() => null),
        fetchResults(scanId, 1, limit, [], '', ''),
      ]);
      if (details) setScanDetails({
        scanId: details.scanId ?? scanId,
        scannedAt: details.scannedAt ?? '',
        baseCheckIn: details.baseCheckIn ?? null,
        days: details.days ?? null,
        stayNights: details.stayNights ?? null,
        timezone: details.timezone ?? null,
        hotelTotal: details.hotelTotal ?? null,
        hotelBookableActive: details.hotelBookableActive ?? null,
      });
      setResults(resultsData?.data || []);
      setTotal(resultsData?.total || 0);
      setTotalPages(resultsData?.totalPages || 0);
    } catch (e: any) { setError(e.message || 'Failed to load results'); }
    finally { setReloading(false); }
  }, [limit, fetchResults]);

  // Reload when filters/page change
  React.useEffect(() => {
    if (initialLoading || !selectedScanId) return;
    setReloading(true);
    setError(null);
    fetchResults(selectedScanId, page, limit, selectedHotelIds, selectedCheckInDate, selectedSource)
      .then(data => { setResults(data.data || []); setTotal(data.total || 0); setTotalPages(data.totalPages || 0); })
      .catch(e => setError(e.message || 'Failed to load results'))
      .finally(() => setReloading(false));
  }, [page, limit, selectedHotelIds, selectedCheckInDate, selectedSource]); // eslint-disable-line react-hooks/exhaustive-deps

  if (initialLoading) return (
    <main><div className="text-center py-5"><div className="spinner-border" role="status" /></div></main>
  );

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>

        <ScanInfoCard
          scans={scans}
          selectedScanId={selectedScanId}
          onScanChange={handleScanChange}
          scanDetails={scanDetails}
        />

        {/* ── Controls ── */}
        <div className="d-flex gap-3 mb-3 flex-wrap">
          <HotelCombobox
            hotels={hotels}
            selectedIds={selectedHotelIds}
            onChange={ids => { setSelectedHotelIds(ids); setPage(1); }}
            placeholder="All Hotels"
            style={{ maxWidth: 300 }}
          />

          <select
            className="form-select"
            style={{ maxWidth: 180 }}
            value={selectedSource}
            onChange={e => { setSelectedSource(e.target.value); setPage(1); }}
          >
            <option value="">All sources</option>
            <option value="amello">Amello</option>
            <option value="booking">Booking (Standard)</option>
            <option value="booking_member">Booking (Member)</option>
          </select>

          <div className="d-flex align-items-center gap-2">
            <input
              type="date"
              className="form-control"
              style={{ maxWidth: 160 }}
              value={selectedCheckInDate}
              onChange={e => { setSelectedCheckInDate(e.target.value); setPage(1); }}
            />
            {selectedCheckInDate && (
              <button className="btn btn-outline-secondary btn-sm" onClick={() => { setSelectedCheckInDate(''); setPage(1); }}>
                ✕
              </button>
            )}
          </div>

          <button
            className="btn btn-outline-secondary ms-auto"
            onClick={() => { if (selectedScanId) window.open(`/api/scans/${selectedScanId}/export?format=long`, '_blank'); }}
            disabled={selectedScanId == null}
          >
            Export CSV
          </button>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        {reloading && (
          <div className="text-center py-2">
            <div className="spinner-border spinner-border-sm text-secondary" role="status" />
          </div>
        )}

        {results.length > 0 ? (
          <>
            <div className="mb-3">
              <PaginationBar
                page={page} totalPages={totalPages} totalItems={total}
                itemsPerPage={limit} itemLabel="results"
                onPage={setPage}
                onPerPage={n => { setLimit(n); setPage(1); }}
              />
            </div>

            <div className="table-responsive border rounded mb-3">
              <table className="table table-sm table-striped mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Scan ID</th>
                    <th>Hotel</th>
                    <th>Check-in</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th>Room</th>
                    <th>Rate</th>
                    <th className="text-end">Actual Price</th>
                    <th className="text-end">Base Price</th>
                    <th>Link</th>
                    <th>JSON</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(result => {
                    const { roomName, rateName, price: actualPrice, currency, memberPrice: basePrice } =
                      result.status === 'green'
                        ? extractLowestPrice(result.response_json)
                        : { roomName: null, rateName: null, price: null, currency: null, memberPrice: null };
                    const stayNights = scans.find(s => s.id === result.scan_id)?.stay_nights ?? 7;
                    const { label, badgeClass } = getSourceDisplay(result.source);
                    return (
                      <tr key={`${result.scan_id}-${result.hotel_id}-${result.check_in_date}-${result.source}`}>
                        <td>{result.scan_id}</td>
                        <td>{result.hotel_name ?? `Hotel ${result.hotel_id}`}</td>
                        <td className="text-nowrap">{result.check_in_date}</td>
                        <td>
                          <span className={`badge ${result.status === 'green' ? 'bg-success' : 'bg-danger'}`}>
                            {result.status}
                          </span>
                        </td>
                        <td><span className={`badge ${badgeClass}`}>{label}</span></td>
                        <td className="small">{roomName ?? '—'}</td>
                        <td className="small">{rateName ?? '—'}</td>
                        <td className="text-end text-nowrap">{formatPrice(actualPrice, currency)}</td>
                        <td className="text-end text-nowrap">
                          {basePrice != null
                            ? <span className="text-muted text-decoration-line-through">{formatPrice(basePrice, currency)}</span>
                            : <span className="text-muted">—</span>}
                        </td>
                        <td>
                          {(() => {
                            const url = buildSourceUrl(result, stayNights);
                            return url
                              ? <a href={url} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-secondary">Open</a>
                              : <span className="text-muted">—</span>;
                          })()}
                        </td>
                        <td>
                          <details>
                            <summary className="btn btn-sm btn-outline-secondary">View</summary>
                            <pre className="small mt-2" style={{ maxHeight: 200, overflow: 'auto' }}>
                              {JSON.stringify(result.response_json, null, 2)}
                            </pre>
                          </details>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-2 mb-4">
              <PaginationBar
                page={page} totalPages={totalPages} totalItems={total}
                itemsPerPage={limit} itemLabel="results"
                onPage={setPage}
                onPerPage={n => { setLimit(n); setPage(1); }}
              />
            </div>
          </>
        ) : !reloading ? (
          <p className="text-muted">No results found{selectedScanId ? ' for this scan' : ''}.</p>
        ) : null}
      </div>
    </main>
  );
}
