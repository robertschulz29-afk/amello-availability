'use client';
// app/room-imagery/page.tsx

import * as React from 'react';
import Link from 'next/link';
import { fetchJSON } from '@/lib/api-client';

// ── Types ─────────────────────────────────────────────────────────────────────

type ReportRow = {
  hotel_id: number;
  hotel_name: string;
  active: boolean;
  bookable: boolean;
  scan_room_name: string;
  imagery_room_name: string | null;
  image_url: string | null;
};

type HotelGroup = {
  hotel_id: number;
  hotel_name: string;
  active: boolean;
  bookable: boolean;
  rows: ReportRow[];
};

// ── Per-hotel card ────────────────────────────────────────────────────────────

function HotelCard({ group }: { group: HotelGroup }) {
  const [collapsed, setCollapsed] = React.useState(false);

  const missingCount = group.rows.filter(r => !r.image_url).length;

  return (
    <div className="card mb-3">
      <div
        className="card-header d-flex align-items-center gap-2 flex-wrap"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setCollapsed(c => !c)}
      >
        <span className="fw-semibold">{group.hotel_name}</span>
        <div className="ms-auto d-flex align-items-center gap-2 flex-wrap">
          {missingCount > 0 && (
            <span className="badge text-bg-warning">{missingCount} missing</span>
          )}
          {missingCount === 0 && group.rows.length > 0 && (
            <span className="badge text-bg-success">all images present</span>
          )}
          <Link
            href="/imagery-mappings"
            className="btn btn-sm btn-outline-secondary"
            style={{ fontSize: '0.75rem', padding: '1px 8px' }}
            onClick={e => e.stopPropagation()}
          >
            Manage mappings →
          </Link>
          <span className="text-muted small">{collapsed ? '▼' : '▲'}</span>
        </div>
      </div>

      {!collapsed && (
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-sm table-hover mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th>Scan Room Name</th>
                  <th>Image</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map(row => (
                  <tr key={row.scan_room_name}>
                    <td className="small align-middle">{row.scan_room_name}</td>
                    <td className="align-middle" style={{ width: 100 }}>
                      {row.image_url ? (
                        <img
                          src={row.image_url}
                          alt={row.scan_room_name}
                          style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 4 }}
                        />
                      ) : (
                        <span className="badge text-bg-warning">image missing</span>
                      )}
                    </td>
                    <td className="align-middle">
                      {row.imagery_room_name ? (
                        <span className="badge text-bg-success">mapped</span>
                      ) : (
                        <span className="badge text-bg-secondary">unmapped</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Page() {
  const [rows, setRows]           = React.useState<ReportRow[]>([]);
  const [loading, setLoading]     = React.useState(true);
  const [error, setError]         = React.useState<string | null>(null);
  const [search, setSearch]       = React.useState('');
  const [filterActive,   setFilterActive]   = React.useState(false);
  const [filterBookable, setFilterBookable] = React.useState(false);
  const [missingOnly,    setMissingOnly]    = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterActive)   params.set('active',      'true');
      if (filterBookable) params.set('bookable',     'true');
      if (missingOnly)    params.set('missingOnly',  'true');
      const qs = params.toString() ? `?${params.toString()}` : '';
      const data = await fetchJSON(`/api/room-imagery/report${qs}`, { cache: 'no-store' });
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [filterActive, filterBookable, missingOnly]);

  React.useEffect(() => { load(); }, [load]);

  // Group rows by hotel
  const groups = React.useMemo<HotelGroup[]>(() => {
    const map = new Map<number, HotelGroup>();
    for (const row of rows) {
      if (!map.has(row.hotel_id)) {
        map.set(row.hotel_id, {
          hotel_id:   row.hotel_id,
          hotel_name: row.hotel_name,
          active:     row.active,
          bookable:   row.bookable,
          rows:       [],
        });
      }
      map.get(row.hotel_id)!.rows.push(row);
    }
    return Array.from(map.values());
  }, [rows]);

  const filtered = React.useMemo(() => {
    if (!search.trim()) return groups;
    const term = search.toLowerCase();
    return groups.filter(g => g.hotel_name.toLowerCase().includes(term));
  }, [groups, search]);

  const totalMissing = React.useMemo(
    () => rows.filter(r => !r.image_url).length,
    [rows],
  );

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>

        <div className="d-flex align-items-center gap-3 mb-4 flex-wrap">
          <h1 className="h4 mb-0">Room Imagery</h1>
          {!loading && totalMissing > 0 && (
            <span className="badge text-bg-warning fs-6">{totalMissing} missing images</span>
          )}
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <div className="mb-3 d-flex flex-wrap gap-2 align-items-center">
          <input
            className="form-control"
            style={{ maxWidth: 280 }}
            placeholder="Filter hotels…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="form-check form-switch mb-0 ms-2">
            <input
              className="form-check-input"
              type="checkbox"
              id="filterActive"
              checked={filterActive}
              onChange={e => setFilterActive(e.target.checked)}
            />
            <label className="form-check-label" htmlFor="filterActive">Active only</label>
          </div>
          <div className="form-check form-switch mb-0">
            <input
              className="form-check-input"
              type="checkbox"
              id="filterBookable"
              checked={filterBookable}
              onChange={e => setFilterBookable(e.target.checked)}
            />
            <label className="form-check-label" htmlFor="filterBookable">Bookable only</label>
          </div>
          <div className="form-check form-switch mb-0">
            <input
              className="form-check-input"
              type="checkbox"
              id="missingOnly"
              checked={missingOnly}
              onChange={e => setMissingOnly(e.target.checked)}
            />
            <label className="form-check-label" htmlFor="missingOnly">Missing only</label>
          </div>
        </div>

        {loading && (
          <div className="text-center my-5">
            <div className="spinner-border text-primary" role="status"></div>
            <div className="mt-2 text-muted">Loading room imagery report…</div>
          </div>
        )}

        {!loading && filtered.map(group => (
          <HotelCard key={group.hotel_id} group={group} />
        ))}

        {!loading && filtered.length === 0 && (
          <p className="text-muted">No hotels match the filter.</p>
        )}
      </div>
    </main>
  );
}
