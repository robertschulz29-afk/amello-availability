// app/scan-results/page.tsx
'use client';

import * as React from 'react';

type ScanResult = {
  id: number;
  scan_id: number;
  hotel_id: number;
  check_in_date: string;
  status: 'green' | 'red';
  response_json: any;
};

type Scan = {
  id: number;
  scanned_at: string;
  status: string;
};

async function fetchJSON(input: RequestInfo, init?: RequestInit) {
  const r = await fetch(input, init);
  const text = await r.text();
  if (!r.ok) {
    try {
      const j = JSON.parse(text);
      throw new Error(j.error || r.statusText);
    } catch {
      throw new Error(text || r.statusText);
    }
  }
  return text ? JSON.parse(text) : null;
}

function fmtDate(dt: string) {
  try {
    return new Date(dt).toLocaleDateString();
  } catch {
    return dt;
  }
}

function fmtDateTime(dt: string) {
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt;
  }
}

function truncateJSON(json: any, maxLength = 50): string {
  const str = JSON.stringify(json);
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
}

export default function ScanResultsPage() {
  // State
  const [results, setResults] = React.useState<ScanResult[]>([]);
  const [scans, setScans] = React.useState<Scan[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Filters
  const [selectedScanId, setSelectedScanId] = React.useState<string>('');
  const [selectedStatus, setSelectedStatus] = React.useState<string>('');

  // Pagination
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(100);
  const [total, setTotal] = React.useState(0);
  const [totalPages, setTotalPages] = React.useState(0);

  // Modal
  const [modalData, setModalData] = React.useState<any>(null);
  const [showModal, setShowModal] = React.useState(false);

  // Load scans list
  const loadScans = React.useCallback(async () => {
    try {
      const data = await fetchJSON('/api/scans', { cache: 'no-store' });
      const arr: Scan[] = Array.isArray(data) ? data : [];
      arr.sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime());
      setScans(arr);
    } catch (e: any) {
      console.error('Failed to load scans:', e);
    }
  }, []);

  // Load scan results
  const loadResults = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (selectedScanId) params.append('scanId', selectedScanId);
      if (selectedStatus) params.append('status', selectedStatus);

      const data = await fetchJSON(`/api/scan-results?${params}`, { cache: 'no-store' });
      setResults(data.data || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 0);
    } catch (e: any) {
      setError(e.message || 'Failed to load scan results');
    } finally {
      setLoading(false);
    }
  }, [page, limit, selectedScanId, selectedStatus]);

  React.useEffect(() => {
    loadScans();
  }, [loadScans]);

  React.useEffect(() => {
    loadResults();
  }, [loadResults]);

  // Reset to page 1 when filters change
  React.useEffect(() => {
    setPage(1);
  }, [selectedScanId, selectedStatus, limit]);

  // Pagination handlers
  const goToFirst = () => setPage(1);
  const goToPrev = () => setPage(Math.max(1, page - 1));
  const goToNext = () => setPage(Math.min(totalPages, page + 1));
  const goToLast = () => setPage(totalPages);

  // Modal handlers
  const openModal = (json: any) => {
    setModalData(json);
    setShowModal(true);
  };
  const closeModal = () => {
    setShowModal(false);
    setModalData(null);
  };

  // CSV Export
  const exportCSV = () => {
    if (results.length === 0) {
      alert('No data to export');
      return;
    }

    const headers = ['ID', 'Scan ID', 'Hotel ID', 'Check-in Date', 'Status', 'Response JSON'];
    const rows = results.map((r) => [
      r.id,
      r.scan_id,
      r.hotel_id,
      r.check_in_date,
      r.status,
      JSON.stringify(r.response_json),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `scan-results-${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => alert('Copied to clipboard!'),
      (err) => alert('Failed to copy: ' + err)
    );
  };

  const startIndex = (page - 1) * limit + 1;
  const endIndex = Math.min(page * limit, total);

  return (
    <main>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2>Scan Results Database</h2>
        <button className="btn btn-primary" onClick={exportCSV} disabled={results.length === 0}>
          <i className="fas fa-download me-2"></i>Download CSV
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-3">
        <div className="card-header">Filters</div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">Scan ID</label>
              <select
                className="form-select"
                value={selectedScanId}
                onChange={(e) => setSelectedScanId(e.target.value)}
              >
                <option value="">All Scans</option>
                {scans.map((s) => (
                  <option key={s.id} value={s.id}>
                    #{s.id} - {fmtDateTime(s.scanned_at)} ({s.status})
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">Status</label>
              <select
                className="form-select"
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
              >
                <option value="">All Status</option>
                <option value="green">Green</option>
                <option value="red">Red</option>
              </select>
            </div>
            <div className="col-md-4">
              <label className="form-label">Results per page</label>
              <select
                className="form-select"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              >
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="250">250</option>
                <option value="500">500</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Pagination Info */}
      {total > 0 && (
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div className="text-muted">
            Showing {startIndex}-{endIndex} of {total.toLocaleString()} results
          </div>
          <div className="btn-group">
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={goToFirst}
              disabled={page === 1 || loading}
            >
              First
            </button>
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={goToPrev}
              disabled={page === 1 || loading}
            >
              Previous
            </button>
            <button className="btn btn-sm btn-outline-secondary" disabled>
              Page {page} of {totalPages}
            </button>
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={goToNext}
              disabled={page === totalPages || loading}
            >
              Next
            </button>
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={goToLast}
              disabled={page === totalPages || loading}
            >
              Last
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && <div className="alert alert-danger">{error}</div>}

      {/* Loading */}
      {loading && (
        <div className="text-center my-5">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      )}

      {/* Results Table */}
      {!loading && results.length > 0 && (
        <div className="table-responsive">
          <table className="table table-striped table-hover">
            <thead className="table-dark">
              <tr>
                <th>ID</th>
                <th>Scan ID</th>
                <th>Hotel ID</th>
                <th>Check-in Date</th>
                <th>Status</th>
                <th>Response JSON</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.scan_id}</td>
                  <td>{r.hotel_id}</td>
                  <td>{fmtDate(r.check_in_date)}</td>
                  <td>
                    <span
                      className={`badge ${
                        r.status === 'green' ? 'bg-success' : 'bg-danger'
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="small font-monospace">
                    {truncateJSON(r.response_json)}
                  </td>
                  <td>
                    <button
                      className="btn btn-sm btn-outline-primary"
                      onClick={() => openModal(r.response_json)}
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty State */}
      {!loading && results.length === 0 && (
        <div className="alert alert-info">
          No scan results found. Try adjusting your filters.
        </div>
      )}

      {/* Pagination Controls (Bottom) */}
      {total > 0 && (
        <div className="d-flex justify-content-between align-items-center mt-3">
          <div className="text-muted">
            Showing {startIndex}-{endIndex} of {total.toLocaleString()} results
          </div>
          <div className="btn-group">
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={goToFirst}
              disabled={page === 1 || loading}
            >
              First
            </button>
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={goToPrev}
              disabled={page === 1 || loading}
            >
              Previous
            </button>
            <button className="btn btn-sm btn-outline-secondary" disabled>
              Page {page} of {totalPages}
            </button>
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={goToNext}
              disabled={page === totalPages || loading}
            >
              Next
            </button>
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={goToLast}
              disabled={page === totalPages || loading}
            >
              Last
            </button>
          </div>
        </div>
      )}

      {/* Modal for View Details */}
      {showModal && (
        <div
          className="modal fade show"
          style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={closeModal}
        >
          <div
            className="modal-dialog modal-lg modal-dialog-scrollable"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Response JSON Details</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={closeModal}
                  aria-label="Close"
                ></button>
              </div>
              <div className="modal-body">
                <pre
                  className="bg-light p-3 rounded"
                  style={{ maxHeight: '60vh', overflow: 'auto' }}
                >
                  {JSON.stringify(modalData, null, 2)}
                </pre>
              </div>
              <div className="modal-footer">
                <button
                  className="btn btn-secondary"
                  onClick={() => copyToClipboard(JSON.stringify(modalData, null, 2))}
                >
                  <i className="fas fa-copy me-2"></i>Copy to Clipboard
                </button>
                <button className="btn btn-primary" onClick={closeModal}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
