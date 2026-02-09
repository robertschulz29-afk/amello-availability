// app/scan-results/page.tsx
'use client';

import * as React from 'react';

type ScanRow = {
  id: number; 
  scanned_at: string;
  stay_nights: number; 
  total_cells: number; 
  done_cells: number;
  status: 'queued'|'running'|'done'|'error';
};

type ScanResult = {
  scan_id: number;
  hotel_id: number;
  check_in_date: string;
  status: 'green' | 'red';
  response_json: any;
};

type PaginatedResponse = {
  data: ScanResult[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

async function fetchJSON(input: RequestInfo, init?: RequestInit) {
  const r = await fetch(input, init);
  const text = await r.text();
  if (!r.ok) {
    try { const j = JSON.parse(text); throw new Error(j.error || r.statusText); }
    catch { throw new Error(text || r.statusText); }
  }
  return text ? JSON.parse(text) : null;
}

function fmtDateTime(dt: string) {
  try { return new Date(dt).toLocaleString(); } catch { return dt; }
}

export default function Page() {
  // Scans list for the dropdown
  const [scans, setScans] = React.useState<ScanRow[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);

  // Results and pagination
  const [results, setResults] = React.useState<ScanResult[]>([]);
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(100);
  const [total, setTotal] = React.useState(0);
  const [totalPages, setTotalPages] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

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
      const url = `/api/scan-results?scanID=${selectedScanId}&page=${page}&limit=${limit}`;
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
  }, [selectedScanId, page, limit]);

  React.useEffect(() => { loadScans(); }, [loadScans]);
  React.useEffect(() => { loadResults(); }, [loadResults]);

  // Pagination handlers
  const goToFirstPage = () => setPage(1);
  const goToPrevPage = () => setPage(p => Math.max(1, p - 1));
  const goToNextPage = () => setPage(p => Math.min(totalPages, p + 1));
  const goToLastPage = () => setPage(totalPages);

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
                    <th>Hotel ID</th>
                    <th>Check-in Date</th>
                    <th>Status</th>
                    <th>Response JSON</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(result => (
                    <tr key={`${result.scan_id}-${result.hotel_id}-${result.check_in_date}`}>
                      <td>{result.scan_id}</td>
                      <td>{result.hotel_id}</td>
                      <td>{result.check_in_date}</td>
                      <td>
                        <span className={`badge ${result.status === 'green' ? 'bg-success' : 'bg-danger'}`}>
                          {result.status}
                        </span>
                      </td>
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
                  ))}
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
