'use client';

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';

type GlobalType = {
  global_type: string;
  collector_id: number | null;
  collector_name: string | null;
  global_type_category: string | null;
};

type Hotel = {
  id: number;
  name: string;
  code: string;
  brand?: string;
  region?: string;
  country?: string;
  booking_url?: string | null;
  tuiamello_url?: string | null;
  expedia_url?: string | null;
  bookable?: boolean | null;
  active?: boolean | null;
  base_image?: string | null;
  globalTypes?: string[] | null;
};

type SortField = 'name' | 'brand' | 'region';
type SortDir   = 'asc' | 'desc';
type FilterBool = 'all' | 'true' | 'false';

function isValidUrl(urlString: string): boolean {
  if (!urlString.trim()) return true;
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const SUCCESS_MESSAGE_TIMEOUT_MS = 5000;

export default function Page() {
  const [hotels, setHotels] = React.useState<Hotel[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null);

  const [syncBusy, setSyncBusy] = React.useState(false);
  const [syncWarnings, setSyncWarnings] = React.useState<string[]>([]);

  const [globalTypeOptions, setGlobalTypeOptions] = React.useState<GlobalType[]>([]);
  const [selectedCollectorIds, setSelectedCollectorIds] = React.useState<Set<number>>(new Set());

  const [filterActive,   setFilterActive]   = React.useState<FilterBool>('all');
  const [filterBookable, setFilterBookable] = React.useState<FilterBool>('all');
  const [sortField, setSortField] = React.useState<SortField>('name');
  const [sortDir,   setSortDir]   = React.useState<SortDir>('asc');

  const [editingHotel, setEditingHotel] = React.useState<Hotel | null>(null);
  const [editBrand, setEditBrand] = React.useState('');
  const [editRegion, setEditRegion] = React.useState('');
  const [editCountry, setEditCountry] = React.useState('');
  const [editBookingUrl, setEditBookingUrl] = React.useState('');
  const [editTuiamelloUrl, setEditTuiamelloUrl] = React.useState('');
  const [editExpediaUrl, setEditExpediaUrl] = React.useState('');
  const [editBookable, setEditBookable] = React.useState(true);
  const [editActive, setEditActive] = React.useState(true);
  const [editBusy, setEditBusy] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);

  const [globalTypesHotel, setGlobalTypesHotel] = React.useState<Hotel | null>(null);
  const [globalTypeFilterOpen, setGlobalTypeFilterOpen] = React.useState(false);
  const [copiedCodes, setCopiedCodes] = React.useState(false);

  const copyHotelCodes = () => {
    const codes = visibleHotels.map(h => h.code).join(', ');
    navigator.clipboard.writeText(codes).then(() => {
      setCopiedCodes(true);
      setTimeout(() => setCopiedCodes(false), 2000);
    });
  };

  const [deleteHotel, setDeleteHotel] = React.useState<Hotel | null>(null);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const loadHotels = React.useCallback(async (globalTypeCodes: string[] = []) => {
    try {
      const params = new URLSearchParams();
      if (globalTypeCodes.length > 0) params.set('globalTypes', globalTypeCodes.join(','));
      const url = params.toString() ? `/api/hotels?${params}` : '/api/hotels';
      const data = await fetchJSON(url, { cache: 'no-store' } as RequestInit);
      setHotels(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setLoadError(e.message || 'Failed to load hotels');
    }
  }, []);

  React.useEffect(() => {
    fetchJSON('/api/global_types', { cache: 'no-store' } as RequestInit)
      .then((data: GlobalType[]) => setGlobalTypeOptions(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Single effect: re-runs when selection or available options change.
  // Waits for options to load before applying a collector filter.
  React.useEffect(() => {
    if (selectedCollectorIds.size > 0 && globalTypeOptions.length === 0) return;
    const codes = globalTypeOptions
      .filter(gt => gt.collector_id != null && selectedCollectorIds.has(gt.collector_id!))
      .map(gt => gt.global_type);
    if (selectedCollectorIds.size > 0 && codes.length === 0) return;
    loadHotels(codes);
  }, [selectedCollectorIds, globalTypeOptions, loadHotels]);

  React.useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(null), SUCCESS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [successMsg]);

  const parseGlobalTypes = (raw: string[] | string | null | undefined): string[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  };

  const visibleHotels = React.useMemo(() => {
    let list = [...hotels];
    if (filterActive !== 'all') {
      const want = filterActive === 'true';
      list = list.filter(h => h.active === want);
    }
    if (filterBookable !== 'all') {
      const want = filterBookable === 'true';
      list = list.filter(h => h.bookable === want);
    }
    list.sort((a, b) => {
      const av = (a[sortField] ?? '').toLowerCase();
      const bv = (b[sortField] ?? '').toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 :  1;
      if (av > bv) return sortDir === 'asc' ?  1 : -1;
      return 0;
    });
    return list;
  }, [hotels, filterActive, filterBookable, sortField, sortDir]);

  const activeCount       = hotels.filter(h => h.active === true).length;
  const inactiveCount     = hotels.filter(h => h.active === false).length;
  const bookableCount     = hotels.filter(h => h.bookable === true).length;
  const nonBookableCount  = hotels.filter(h => h.bookable === false).length;
  const activeAndBookable = hotels.filter(h => h.active === true && h.bookable === true).length;

  const updateHotelList = async () => {
    setLoadError(null);
    setSuccessMsg(null);
    setSyncWarnings([]);
    setSyncBusy(true);
    try {
      const result = await fetchJSON('/api/hotels/sync', { method: 'POST' });
      if (result.error) throw new Error(result.error);
      setHotels(Array.isArray(result.hotels) ? result.hotels : []);
      setSyncWarnings(result.errors ?? []);
      setSuccessMsg(
        `Sync complete: ${result.synced} hotel${result.synced !== 1 ? 's' : ''} synced` +
        (result.skipped > 0 ? `, ${result.skipped} skipped` : '') + '.',
      );
    } catch (e: any) {
      setLoadError(e.message || 'Sync failed');
    } finally {
      setSyncBusy(false);
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const openEdit = (hotel: Hotel) => {
    setEditingHotel(hotel);
    setEditBrand(hotel.brand ?? '');
    setEditRegion(hotel.region ?? '');
    setEditCountry(hotel.country ?? '');
    setEditBookingUrl(hotel.booking_url ?? '');
    setEditTuiamelloUrl(hotel.tuiamello_url ?? '');
    setEditExpediaUrl(hotel.expedia_url ?? '');
    setEditBookable(hotel.bookable ?? true);
    setEditActive(hotel.active ?? true);
    setEditError(null);
  };

  const closeEdit = () => {
    if (editBusy) return;
    setEditingHotel(null);
    setEditError(null);
  };

  const saveEdit = async () => {
    if (!editingHotel) return;
    setEditError(null);
    if (!isValidUrl(editBookingUrl))   { setEditError('Invalid Booking.com URL'); return; }
    if (!isValidUrl(editTuiamelloUrl)) { setEditError('Invalid TUIAmello URL');   return; }
    if (!isValidUrl(editExpediaUrl))   { setEditError('Invalid Expedia URL');     return; }
    setEditBusy(true);
    try {
      const updated: Hotel = await fetchJSON(`/api/hotels/${editingHotel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand:         editBrand.trim()        || null,
          region:        editRegion.trim()       || null,
          country:       editCountry.trim()      || null,
          booking_url:   editBookingUrl.trim()   || null,
          tuiamello_url: editTuiamelloUrl.trim() || null,
          expedia_url:   editExpediaUrl.trim()   || null,
          bookable:      editBookable,
          active:        editActive,
        }),
      });
      setHotels(prev => prev.map(h => h.id === editingHotel.id ? { ...h, ...updated } : h));
      setEditingHotel(null);
      setSuccessMsg('Hotel updated successfully!');
    } catch (e: any) {
      setEditError(e.message || 'Update failed');
    } finally {
      setEditBusy(false);
    }
  };

  const openDelete = (hotel: Hotel) => { setDeleteHotel(hotel); setDeleteError(null); };

  const closeDelete = () => {
    if (deleteBusy) return;
    setDeleteHotel(null);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!deleteHotel) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await fetchJSON(`/api/hotels/${deleteHotel.id}`, { method: 'DELETE' });
      setHotels(prev => prev.filter(h => h.id !== deleteHotel.id));
      setDeleteHotel(null);
      setSuccessMsg(`Hotel "${deleteHotel.name}" deleted successfully!`);
    } catch (e: any) {
      setDeleteError(e.message || 'Failed to delete hotel');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>

        {successMsg && (
          <div className="alert alert-success alert-dismissible fade show" role="alert">
            <i className="fa fa-check-circle me-2"></i>{successMsg}
            <button type="button" className="btn-close" onClick={() => setSuccessMsg(null)}></button>
          </div>
        )}
        {loadError && (
          <div className="alert alert-danger alert-dismissible fade show" role="alert">
            <i className="fa fa-exclamation-circle me-2"></i>{loadError}
            <button type="button" className="btn-close" onClick={() => setLoadError(null)}></button>
          </div>
        )}
        {syncWarnings.length > 0 && (
          <div className="alert alert-warning alert-dismissible fade show" role="alert">
            <strong>{syncWarnings.length} hotel{syncWarnings.length !== 1 ? 's' : ''} could not be fetched:</strong>
            <ul className="mb-0 mt-1 small">
              {syncWarnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
            <button type="button" className="btn-close" onClick={() => setSyncWarnings([])}></button>
          </div>
        )}

        {/* ── Toolbar ──────────────────────────────────────────────────── */}
        <div className="card mb-3">
          
          <div className="card-body d-flex flex-wrap align-items-end gap-3">
            <div>
              <label className="form-label fw-semibold mb-1 d-block small">Active</label>
              <div className="btn-group btn-group-sm" role="group">
                {(['all', 'true', 'false'] as FilterBool[]).map(v => (
                  <button key={v} type="button" className={`btn ${filterActive === v ? 'btn-secondary' : 'btn-outline-secondary'}`} onClick={() => setFilterActive(v)}>
                    {v === 'all' ? 'All' : v === 'true' ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="form-label fw-semibold mb-1 d-block small">Bookable</label>
              <div className="btn-group btn-group-sm" role="group">
                {(['all', 'true', 'false'] as FilterBool[]).map(v => (
                  <button key={v} type="button" className={`btn ${filterBookable === v ? 'btn-secondary' : 'btn-outline-secondary'}`} onClick={() => setFilterBookable(v)}>
                    {v === 'all' ? 'All' : v === 'true' ? 'Yes' : 'No'}
                  </button>
                ))}
                
              </div>
            </div>
            <div>
              <label className="form-label fw-semibold mb-1 d-block small">Sort by</label>
              <div className="btn-group btn-group-sm" role="group">
                {(['name', 'brand', 'region'] as SortField[]).map(f => (
                  <button key={f} type="button" className={`btn ${sortField === f ? 'btn-secondary' : 'btn-outline-secondary'}`} onClick={() => toggleSort(f)}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}{sortIcon(f)}
                  </button>
                ))}
              </div>
            </div>
            <div className="ms-auto">
              <button className="btn btn-dark" onClick={updateHotelList} disabled={syncBusy}>
                {syncBusy
                  ? <><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Syncing…</>
                  : 'Update Hotel List'
                }
              </button>
              
            </div>
            <button
                  className="btn btn-outline-secondary"
                  onClick={() => {
                    window.open(`/api/hotels/export/?format=long`, '_blank');
                  }}
                >
                  Export CSV
                </button>
          </div>
        </div>

        {/* ── Global Types Filter ──────────────────────────────────────── */}
        {globalTypeOptions.length > 0 && (() => {
          // Derive collectors (deduplicated by collector_id) from globalTypeOptions
          const collectorMap = new Map<number, { id: number; name: string; category: string }>();
          for (const gt of globalTypeOptions) {
            if (gt.collector_id != null && !collectorMap.has(gt.collector_id)) {
              collectorMap.set(gt.collector_id, {
                id: gt.collector_id,
                name: gt.collector_name ?? String(gt.collector_id),
                category: gt.global_type_category ?? '',
              });
            }
          }
          const collectors = [...collectorMap.values()];
          const categories = [...new Set(collectors.map(c => c.category))].sort();
          const codes = visibleHotels.length > 0 ? visibleHotels.map(h => h.code).join(', ') : '—';
          return (
            <div className="card mb-3">
              <div
                className="card-header d-flex align-items-center justify-content-between py-2"
                style={{ cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setGlobalTypeFilterOpen(o => !o)}
              >
                <span className="fw-semibold small">
                  Filter by Feature
                  {selectedCollectorIds.size > 0 && (
                    <>
                      <span className="badge bg-primary ms-2">{selectedCollectorIds.size}</span>
                      <button
                        className="btn btn-link btn-sm p-0 ms-2 text-decoration-none text-danger"
                        style={{ fontSize: '0.75rem' }}
                        onClick={e => { e.stopPropagation(); setSelectedCollectorIds(new Set()); }}
                      >
                        Clear
                      </button>
                    </>
                  )}
                </span>
                <i className={`fas fa-chevron-${globalTypeFilterOpen ? 'up' : 'down'} small text-muted`} />
              </div>

              {globalTypeFilterOpen && (
                <div className="card-body py-3">
                  <div className="d-flex flex-wrap gap-4 mb-3">
                    {categories.map(cat => {
                      const catCollectors = collectors.filter(c => c.category === cat).sort((a, b) => a.name.localeCompare(b.name));
                      return (
                        <div key={cat || '_'} style={{ minWidth: 180 }}>
                          <div className="fw-semibold small text-muted mb-2">{cat || 'Uncategorized'}</div>
                          <div className="d-flex flex-wrap gap-1">
                            {catCollectors.map(c => {
                              const active = selectedCollectorIds.has(c.id);
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  className={`btn btn-sm ${active ? 'btn-secondary' : 'btn-outline-secondary'}`}
                                  onClick={e => {
                                    e.stopPropagation();
                                    setSelectedCollectorIds(prev => {
                                      const next = new Set(prev);
                                      next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                                      return next;
                                    });
                                  }}
                                >
                                  {c.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {selectedCollectorIds.size > 0 && (
                    <div className="border-top pt-3 mt-1">
                      <div className="d-flex align-items-start gap-2">
                        <div className="flex-grow-1">
                          <span className="small fw-semibold me-2">Hotel codes ({visibleHotels.length}):</span>
                          <span className="small text-muted font-monospace">{codes}</span>
                        </div>
                        <button
                          className="btn btn-sm btn-outline-secondary flex-shrink-0"
                          onClick={e => { e.stopPropagation(); copyHotelCodes(); }}
                          disabled={visibleHotels.length === 0}
                        >
                          <i className={`fas fa-${copiedCodes ? 'check' : 'copy'} me-1`} />
                          {copiedCodes ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Stats ────────────────────────────────────────────────────── */}
        <p className="small text-muted mb-3">
          <strong>Total:</strong> {hotels.length} &nbsp;|&nbsp;
          <strong>Active:</strong> {activeCount} &nbsp;|&nbsp;
          <strong>Inactive:</strong> {inactiveCount} &nbsp;|&nbsp;
          <strong>Bookable:</strong> {bookableCount} &nbsp;|&nbsp;
          <strong>Non-bookable:</strong> {nonBookableCount} &nbsp;|&nbsp;
          <strong>Active &amp; Bookable:</strong> {activeAndBookable} &nbsp;|&nbsp;
          <strong>Showing:</strong> {visibleHotels.length}
        </p>

        <div className="hotelList">
          {visibleHotels.length === 0
            ? <p className="text-muted mb-0">No hotels match the current filters.</p>
            : visibleHotels.map(h => (
              <div className="hotelListCard" key={h.id}>

                {/* ── Image with all overlays ── */}
                <div className="hotelListCardImageContainer">
                  {h.base_image && (
                    <img
                      src={h.base_image}
                      alt={h.name}
                      className="hotelListCardImageContainerImage"
                    />
                  )}

                  {/* Hotel name — bottom left, above gradient */}
                  <div className="hotelListCardImageContainerName">{h.name}</div>

                  {/* Action buttons — top right */}
                  <div className="hotelListCardImageActions">
                    <button
                      className="hotelListCardActionBtn"
                      onClick={() => openEdit(h)}
                      title="Edit hotel"
                    >
                      <i className="fa fa-pencil"></i>
                    </button>
                    <button
                      className="hotelListCardActionBtn hotelListCardActionDelete"
                      onClick={() => openDelete(h)}
                      title="Delete hotel"
                    >
                      <i className="fa fa-trash"></i>
                    </button>
                  </div>
                </div>

                <div className="card-body" style={{ display: 'flex' }}>
                  <table className="table table-sm mb-0" style={{ maxWidth: 400 }}>
                    <tbody>
                      <tr><td><strong>Name:</strong></td><td>{h.name || 'N/A'}</td></tr>
                      <tr><td><strong>Brand:</strong></td><td>{h.brand || 'N/A'}</td></tr>
                      <tr><td><strong>Code:</strong></td><td>{h.code || 'N/A'}</td></tr>
                      <tr><td><strong>Region:</strong></td><td>{h.region || 'N/A'}</td></tr>
                      <tr><td><strong>Country:</strong></td><td>{h.country || 'N/A'}</td></tr>
                      <tr>
                        <td><strong>Booking.com URL:</strong></td>
                        <td>{h.booking_url ? <a href={h.booking_url} target="_blank" rel="noopener noreferrer">{h.booking_url}</a> : 'N/A'}</td>
                      </tr>
                      <tr>
                        <td><strong>TUIAmello URL:</strong></td>
                        <td>{h.tuiamello_url ? <a href={h.tuiamello_url} target="_blank" rel="noopener noreferrer">{h.tuiamello_url}</a> : 'N/A'}</td>
                      </tr>
                      <tr>
                        <td><strong>Expedia URL:</strong></td>
                        <td>{h.expedia_url ? <a href={h.expedia_url} target="_blank" rel="noopener noreferrer">{h.expedia_url}</a> : 'N/A'}</td>
                      </tr>
                      <tr><td><strong>Bookable:</strong></td><td>{h.bookable == null ? 'N/A' : h.bookable ? 'Yes' : 'No'}</td></tr>
                      <tr><td><strong>Active:</strong></td><td>{h.active == null ? 'N/A' : h.active ? 'Yes' : 'No'}</td></tr>
                      <tr>
                        <td><strong>Global Types:</strong></td>
                        <td>
                          <button
                            className="btn btn-link btn-sm p-0 text-decoration-none"
                            onClick={() => setGlobalTypesHotel(h)}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

              </div>
            ))
          }
        </div>

        {/* ── Edit Modal ─────────────────────────────────────────────────── */}
        {editingHotel && (
          <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) closeEdit(); }}>
            <div className="modal-dialog modal-lg modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">
                    Edit — {editingHotel.name}&nbsp;
                    <code className="fs-6 text-muted">{editingHotel.code}</code>
                  </h5>
                  <button type="button" className="btn-close" onClick={closeEdit} disabled={editBusy}></button>
                </div>
                <div className="modal-body">
                  <div className="row g-3">
                    <div className="col-md-4">
                      <label className="form-label fw-semibold">Brand</label>
                      <input className="form-control" value={editBrand} onChange={e => setEditBrand(e.target.value)} disabled={editBusy} placeholder="e.g. TUI BLUE" />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label fw-semibold">Region</label>
                      <input className="form-control" value={editRegion} onChange={e => setEditRegion(e.target.value)} disabled={editBusy} placeholder="e.g. Algarve" />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label fw-semibold">Country</label>
                      <input className="form-control" value={editCountry} onChange={e => setEditCountry(e.target.value)} disabled={editBusy} placeholder="e.g. Portugal" />
                    </div>
                    <div className="col-12">
                      <label className="form-label fw-semibold">Booking.com URL</label>
                      <input type="url" className="form-control" value={editBookingUrl} onChange={e => setEditBookingUrl(e.target.value)} disabled={editBusy} placeholder="https://www.booking.com/…" />
                    </div>
                    <div className="col-12">
                      <label className="form-label fw-semibold">TUIAmello URL</label>
                      <input type="url" className="form-control" value={editTuiamelloUrl} onChange={e => setEditTuiamelloUrl(e.target.value)} disabled={editBusy} placeholder="https://www.tuiamello.com/…" />
                    </div>
                    <div className="col-12">
                      <label className="form-label fw-semibold">Expedia URL</label>
                      <input type="url" className="form-control" value={editExpediaUrl} onChange={e => setEditExpediaUrl(e.target.value)} disabled={editBusy} placeholder="https://www.expedia.com/…" />
                    </div>
                    <div className="col-md-6">
                      <div className="form-check">
                        <input type="checkbox" className="form-check-input" id="editBookable" checked={editBookable} onChange={e => setEditBookable(e.target.checked)} disabled={editBusy} />
                        <label className="form-check-label fw-semibold" htmlFor="editBookable">Bookable</label>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="form-check">
                        <input type="checkbox" className="form-check-input" id="editActive" checked={editActive} onChange={e => setEditActive(e.target.checked)} disabled={editBusy} />
                        <label className="form-check-label fw-semibold" htmlFor="editActive">Active</label>
                      </div>
                    </div>
                  </div>
                  {editError && (
                    <div className="alert alert-danger mt-3 mb-0" role="alert">
                      <i className="fa fa-exclamation-circle me-2"></i>{editError}
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={closeEdit} disabled={editBusy}>Cancel</button>
                  <button type="button" className="btn btn-success" onClick={saveEdit} disabled={editBusy}>
                    {editBusy ? <><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Saving…</> : 'Save changes'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Delete Modal ────────────────────────────────────────────────── */}
        {deleteHotel && (
          <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) closeDelete(); }}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">
                    <i className="fa fa-exclamation-triangle text-warning me-2"></i>
                    Confirm Deletion
                  </h5>
                  <button type="button" className="btn-close" onClick={closeDelete} disabled={deleteBusy}></button>
                </div>
                <div className="modal-body">
                  <p className="mb-2">Are you sure you want to delete this hotel?</p>
                  <div className="alert alert-warning mb-3">
                    <strong>Hotel Name:</strong> {deleteHotel.name}<br />
                    <strong>Hotel Code:</strong> {deleteHotel.code}
                  </div>
                  <p className="text-danger mb-0"><strong>Warning:</strong> This action cannot be undone.</p>
                  {deleteError && <div className="alert alert-danger mt-3 mb-0" role="alert">{deleteError}</div>}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={closeDelete} disabled={deleteBusy}>Cancel</button>
                  <button type="button" className="btn btn-danger" onClick={confirmDelete} disabled={deleteBusy}>
                    {deleteBusy ? <><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Deleting…</> : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Global Types Modal ──────────────────────────────────────────── */}
        {globalTypesHotel && (() => {
          const types = Array.isArray(globalTypesHotel.globalTypes)
            ? globalTypesHotel.globalTypes
            : typeof globalTypesHotel.globalTypes === 'string'
              ? (() => { try { return JSON.parse(globalTypesHotel.globalTypes as string); } catch { return []; } })()
              : [];
          return (
            <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={e => { if (e.target === e.currentTarget) setGlobalTypesHotel(null); }}>
              <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                  <div className="modal-header">
                    <h5 className="modal-title">
                      Global Types — {globalTypesHotel.name}&nbsp;
                      <code className="fs-6 text-muted">{globalTypesHotel.code}</code>
                    </h5>
                    <button type="button" className="btn-close" onClick={() => setGlobalTypesHotel(null)}></button>
                  </div>
                  <div className="modal-body">
                    {types.length > 0
                      ? <ul className="mb-0">{types.map((t: string, i: number) => {
                          const meta = globalTypeOptions.find(g => g.global_type === t);
                          const label = meta
                            ? meta.collector_name || t
                            : t;
                          return <li key={i}>{label}</li>;
                        })}</ul>
                      : <p className="text-muted mb-0">No global types available.</p>
                    }
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={() => setGlobalTypesHotel(null)}>Close</button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      </div>
    </main>
  );
}
