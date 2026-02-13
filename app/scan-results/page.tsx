// app/scan-results/page.tsx
'use client';

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';
import { extractLowestPrice, formatPrice } from '@/lib/price-utils';

type ScanRow = {
  id: number; 
  scanned_at: string;
  stay_nights: number; 
  total_cells: number; 
  done_cells: number;
  status: 'queued'|'running'|'done'|'error';
};

type HotelRow = {
  id: number;
  name: string;
  code: string;
};

type ScanResult = {
  scan_id: number;
  hotel_id: number;
  hotel_name?: string;
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

function fmtDateTime(dt: string) {
  try { return new Date(dt).toLocaleString(); } catch { return dt; }
}

function getHotelDisplay(name: string | null | undefined, id: number): string {
  return name ? `${name} (${id})` : `Hotel ${id}`;
}

function getSourceDisplay(source?: string) {
  if (source === 'booking') {
    return { label: 'Booking.com', badgeClass: 'bg-info' };
  } else if (source === 'amello') {
    return { label: 'Amello', badgeClass: 'bg-secondary' };
  } else {
    return { label: source || '—', badgeClass: 'bg-secondary' };
  }
}

export default function Page() {
  // Scans list for the dropdown
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);

  // Hotels list for the dropdown
  const [hotels, setHotels] = React.useState<HotelRow[]>([]);
  const [selectedHotelId, setSelectedHotelId] = React.useState<number | null>(null);

  // Additional filters
  const [selectedCheckInDate, setSelectedCheckInDate] = React.useState<string>('');
  const [selectedSource, setSelectedSource] = React.useState<string>('');
  const [hotelSearchTerm, setHotelSearchTerm] = React.useState<string>('');

  // Results and pagination
  const [results, setResults] = React.useState<ScanResult[]>([]);
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(100);
  const [total, setTotal] = React.useState(0);
  const [totalPages, setTotalPages] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Helper function to extract price info from a result (no hooks)
  const extractPriceInfo = (result: ScanResult) => {
    return result.status === 'green' 
      ? extractLowestPrice(result.response_json)
      : { roomName: null, rateName: null, price: null, currency: null };
  };

  // Load scans list for dropdown
  const loadScans = React.useCallback(async () => {
    try {
      const list = await fetchJSON('/api/scans', { cache: 'no-store' });
      const arr: ScanRow[] = Array.isArray(list) ? list : [];
      arr.sort((a,b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());
      setScans(arr);
      if (arr.length > 0 && selectedScanId == null) {
        setSelectedScanId(arr[0].id);
      }
    } catch (e:any) {
      setError(e.message || 'Failed to load scans');
    }
  }, [selectedScanId]);

  // Load hotels list for dropdown
  const loadHotels = React.useCallback(async () => {
    try {
      const list = await fetchJSON('/api/hotels', { cache: 'no-store' });
      const arr: HotelRow[] = Array.isArray(list) ? list : [];
      arr.sort((a,b) => a.name.localeCompare(b.name));
      setHotels(arr);
    } catch (e:any) {
      console.error('Failed to load hotels', e);
    }
  }, []);

  // Load scan results with pagination
  const loadResults = React.useCallback(async () => {
    if (selectedScanId == null) {
      setResults([]);
      setTotal(0);
      setTotalPages(0);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        scanID: selectedScanId.toString(),
        page: page.toString(),
        limit: limit.toString(),
      });

      // Add optional filters
      if (selectedHotelId) {
        params.append('hotelID', selectedHotelId.toString());
      }
      if (selectedCheckInDate) {
        params.append('checkInDate', selectedCheckInDate);
      }
      if (selectedSource) {
        params.append('source', selectedSource);
      }

      const url = `/api/scan-results?${params.toString()}`;
      const data: PaginatedResponse = await fetchJSON(url, { cache: 'no-store' });
      setResults(data.data || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 0);
    } catch (e:any) {
      setError(e.message || 'Failed to load results');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [selectedScanId, page, limit, selectedHotelId, selectedCheckInDate, selectedSource]);

  React.useEffect(() => { loadScans(); }, [loadScans]);
  React.useEffect(() => { loadHotels(); }, [loadHotels]);
  React.useEffect(() => { loadResults(); }, [loadResults]);

  // Pagination handlers
  const goToFirstPage = () => setPage(1);
  const goToPrevPage = () => setPage(p => Math.max(1, p - 1));
  const goToNextPage = () => setPage(p => Math.min(totalPages, p + 1));
  const goToLastPage = () => setPage(totalPages);

  // Filter hotels based on search term
  const filteredHotels = React.useMemo(() => {
    if (!hotelSearchTerm.trim()) return hotels;
    const term = hotelSearchTerm.toLowerCase();
    return hotels.filter(h => 
      h.name.toLowerCase().includes(term) || 
      h.code.toLowerCase().includes(term) ||
      h.id.toString().includes(term)
    );
  }, [hotels, hotelSearchTerm]);

  // Reset date filter
  const resetDateFilter = () => {
    setSelectedCheckInDate('');
    setPage(1);
  };

  // Stop scan
  const stopScan = React.useCallback(async (scanId: number) => {
    if (!confirm(`Are you sure you want to stop scan #${scanId}?`)) return;
    try {
      await fetchJSON(`/api/scans/${scanId}/stop`, {
        method: 'POST',
      });
      // Reload scans to reflect cancelled status
      await loadScans();
      await loadResults();
    } catch (e: any) {
      setError(e?.message || 'Failed to stop scan');
    }
  }, [loadScans, loadResults]);

  return (
    <main>
        <h1 className="h3 mb-3">Scan Results</h1>

        {/* Scan selector */}
        <div className="d-flex flex-wrap gap-3 align-items-center mb-3">
          <div className="d-flex align-items-center gap-2">
            <label className="form-label mb-0">Scan ID:</label>
            <select 
              className="form-select" 
              style={{ minWidth: 300 }} 
              value={selectedScanId ?? ''} 
              onChange={e => {
                setSelectedScanId(Number(e.target.value));
                setPage(1); // Reset to first page when changing scan
              }}
            >
              {scans.length === 0 ? (
                <option value="">No scans</option>
              ) : (
                scans.map(s => (
                  <option key={s.id} value={s.id}>
                    #{s.id} • {fmtDateTime(s.scanned_at)} • {s.status} ({s.done_cells}/{s.total_cells})
                  </option>
                ))
              )}
            </select>
            {selectedScanId && scans.find(s => s.id === selectedScanId)?.status === 'running' && (
              <button 
                className="btn btn-danger btn-sm"
                onClick={() => stopScan(selectedScanId)}
                title="Stop this running scan"
              >
                Stop Scan
              </button>
            )}
          </div>

          <div className="d-flex align-items-center gap-2">
            <label className="form-label mb-0">Hotel:</label>
            <div className="d-flex flex-column gap-1">
              <input 
                type="text" 
                className="form-control form-control-sm" 
                style={{ minWidth: 250 }}
                placeholder="Search hotels by name or code..." 
                value={hotelSearchTerm} 
                onChange={e => setHotelSearchTerm(e.target.value)}
              />
              <select 
                className="form-select form-select-sm" 
                style={{ minWidth: 250 }} 
                value={selectedHotelId ?? ''} 
                onChange={e => {
                  setSelectedHotelId(e.target.value ? Number(e.target.value) : null);
                  setPage(1); // Reset to first page when changing filter
                }}
              >
                <option value="">All Hotels</option>
                {filteredHotels.map(h => (
                  <option key={h.id} value={h.id}>
                    {h.name} ({h.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="d-flex align-items-center gap-2">
            <label className="form-label mb-0">Check-in Date:</label>
            <input 
              type="date" 
              className="form-control" 
              style={{ width: 'auto' }}
              value={selectedCheckInDate} 
              onChange={e => {
                setSelectedCheckInDate(e.target.value);
                setPage(1); // Reset to first page when changing filter
              }}
            />
            <button 
              className="btn btn-outline-secondary btn-sm" 
              onClick={resetDateFilter}
              disabled={!selectedCheckInDate}
            >
              Reset
            </button>
          </div>

          <div className="d-flex align-items-center gap-2">
            <label className="form-label mb-0">Source:</label>
            <select 
              className="form-select" 
              style={{ width: 'auto' }}
              value={selectedSource} 
              onChange={e => {
                setSelectedSource(e.target.value);
                setPage(1); // Reset to first page when changing filter
              }}
            >
              <option value="">All</option>
              <option value="booking">Booking.com</option>
              <option value="amello">Amello</option>
            </select>
          </div>

          <div className="d-flex align-items-center gap-2">
            <label className="form-label mb-0">Results per page:</label>
            <select 
              className="form-select" 
              style={{ width: 'auto' }}
              value={limit} 
              onChange={e => {
                setLimit(Number(e.target.value));
                setPage(1); // Reset to first page when changing limit
              }}
            >
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="250">250</option>
              <option value="500">500</option>
            </select>
          </div>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        {/* Results table */}
        {loading ? (
          <div className="text-center py-4">
            <div className="spinner-border" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
          </div>
        ) : results.length > 0 ? (
          <>
            <div className="table-responsive border rounded mb-3">
              <table className="table table-sm table-striped mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Scan ID</th>
                    <th>Hotel Name</th>
                    <th>Check-in Date</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th>Room Name</th>
                    <th>Rate Name</th>
                    <th>Price</th>
                    <th>Response JSON</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(result => {
                    // Extract price info directly without using hooks
                    const priceInfo = extractPriceInfo(result);
                    const sourceDisplay = getSourceDisplay(result.source);
                    
                    return (
                      <tr key={`${result.scan_id}-${result.hotel_id}-${result.check_in_date}`}>
                        <td>{result.scan_id}</td>
                        <td>{result.hotel_name ? result.hotel_name : `Hotel ${result.hotel_id}`}</td>
                        <td>{result.check_in_date}</td>
                        <td>
                          <span className={`badge ${result.status === 'green' ? 'bg-success' : 'bg-danger'}`}>
                            {result.status}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${sourceDisplay.badgeClass}`}>
                            {sourceDisplay.label}
                          </span>
                        </td>
                        <td>{priceInfo.roomName ?? '—'}</td>
                        <td>{priceInfo.rateName ?? '—'}</td>
                        <td>{formatPrice(priceInfo.price, priceInfo.currency)}</td>
                        <td>
                          <details>
                            <summary className="btn btn-sm btn-outline-secondary">View JSON</summary>
                            <pre className="small mt-2" style={{ maxHeight: '200px', overflow: 'auto' }}>
                              {JSON.stringify(result.response_json, null, 2)}
                            </pre>
                          </details>
                        </td>
                        <td>
                          <button 
                            className="btn btn-sm btn-outline-primary"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(JSON.stringify(result.response_json, null, 2));
                                alert('JSON copied to clipboard!');
                              } catch (err) {
                                alert('Failed to copy JSON to clipboard');
                              }
                            }}
                          >
                            Copy JSON
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination controls */}
            <div className="d-flex justify-content-between align-items-center">
              <div className="text-muted">
                Showing {results.length} of {total} results
              </div>
              <div className="d-flex gap-2">
                <button 
                  className="btn btn-outline-secondary btn-sm" 
                  onClick={goToFirstPage}
                  disabled={page === 1}
                >
                  First
                </button>
                <button 
                  className="btn btn-outline-secondary btn-sm" 
                  onClick={goToPrevPage}
                  disabled={page === 1}
                >
                  Previous
                </button>
                <span className="align-self-center px-3">
                  Page {page} of {totalPages}
                </span>
                <button 
                  className="btn btn-outline-secondary btn-sm" 
                  onClick={goToNextPage}
                  disabled={page === totalPages || totalPages === 0}
                >
                  Next
                </button>
                <button 
                  className="btn btn-outline-secondary btn-sm" 
                  onClick={goToLastPage}
                  disabled={page === totalPages || totalPages === 0}
                >
                  Last
                </button>
              </div>
            </div>
          </>
        ) : (
          <p className="text-muted">No results found{selectedScanId ? ' for this scan' : ''}.</p>
        )}
    </main>
  );
}
