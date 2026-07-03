'use client';

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';
import { HotelCombobox } from '@/app/components/HotelCombobox';
import { ScanHotelSelector } from '@/app/components/ScanHotelSelector';
import { OCCUPANCY_CONFIGS } from '@/lib/playwright-scan-helpers';

import {
  PlaywrightScan, HotelEntry, GroupBy, AttentionFilter, QualityFilter, Quality,
  QUALITY_LABELS, QUALITY_COLORS,
  hasAttention, computeQuality,
} from './types';
import { FilterHelpButton, QualityHelpButton } from './HelpPopup';
import { RoomsPanel } from './RoomsPanel';
import { MappingTable, buildMapping, isFixable } from './MappingTable';

// ── Helpers ───────────────────────────────────────────────────────────────────

function tomorrow(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const PAGE_SIZE = 50;

// ── Component ─────────────────────────────────────────────────────────────────

export default function RoomsCrApiPage() {
  // Scan history
  const [scans, setScans] = React.useState<PlaywrightScan[]>([]);
  const [selectedScanId, setSelectedScanId] = React.useState<number | null>(null);

  // Hotel data
  const [entries, setEntries] = React.useState<HotelEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = React.useState(false);
  const [entriesError, setEntriesError] = React.useState<string | null>(null);

  // Active scan polling
  const [activeScanId, setActiveScanId] = React.useState<number | null>(null);
  const [activeScanStatus, setActiveScanStatus] = React.useState<PlaywrightScan | null>(null);

  // Trigger form
  const [checkIn, setCheckIn] = React.useState(tomorrow());
  const [takeScreenshot, setTakeScreenshot] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [startError, setStartError] = React.useState<string | null>(null);

  // Hotels to scan
  const [scanHotels, setScanHotels] = React.useState<{ id: number; name: string; code: string; brand?: string }[]>([]);
  const [scanHotelsLoading, setScanHotelsLoading] = React.useState(true);
  const [scanHotelsLoadError, setScanHotelsLoadError] = React.useState<string | null>(null);
  const [scanHotelIds, setScanHotelIds] = React.useState<number[]>([]);
  const [retryingScanId, setRetryingScanId] = React.useState<number | null>(null);
  const [retryError, setRetryError] = React.useState<string | null>(null);

  const [expandedOcc, setExpandedOcc] = React.useState<Map<number, Set<string>>>(new Map());
  const [expandedHotels, setExpandedHotels] = React.useState<Set<number>>(new Set());

  // Filters & grouping
  const [selectedHotelIds, setSelectedHotelIds] = React.useState<number[]>([]);
  const [groupBy, setGroupBy] = React.useState<GroupBy>('none');
  const [attentionFilter, setAttentionFilter] = React.useState<AttentionFilter>('all');
  const [qualityFilter, setQualityFilter] = React.useState<QualityFilter>('all');
  const [fixPotentialOverrides, setFixPotentialOverrides] = React.useState<Map<number, boolean>>(new Map());
  const [hotelPage, setHotelPage] = React.useState(0);
  const [summaryOpen, setSummaryOpen] = React.useState(true);

  const allHotels = React.useMemo(
    () => entries.map(e => ({ id: e.hotel.id, name: e.hotel.name, code: e.hotel.code, brand: e.hotel.brand ?? undefined })),
    [entries],
  );

  function isEntryFixable(entry: HotelEntry): boolean {
    return isFixable(entry.crRooms, entry.playwrightResults);
  }

  const filtered = React.useMemo(() => {
    return entries.filter(e => {
      if (selectedHotelIds.length > 0 && !selectedHotelIds.includes(e.hotel.id)) return false;
      if (attentionFilter === 'attention' && !hasAttention(e)) return false;
      if (attentionFilter === 'fixable' && !isEntryFixable(e)) return false;
      if (qualityFilter !== 'all' && computeQuality(e) !== qualityFilter) return false;
      return true;
    });
  }, [entries, selectedHotelIds, attentionFilter, qualityFilter]);

  const groups = React.useMemo(() => {
    if (groupBy === 'none') {
      return filtered.map(e => ({ key: String(e.hotel.id), label: e.hotel.name, entries: [e] }));
    }
    const map = new Map<string, HotelEntry[]>();
    for (const e of filtered) {
      const key = groupBy === 'brand' ? (e.hotel.brand ?? '(No Brand)') : groupBy === 'region' ? (e.hotel.region ?? '(No Region)') : (e.hotel.country ?? '(No Country)');
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, es]) => ({ key, label: key, entries: es.sort((a, b) => a.hotel.name.localeCompare(b.hotel.name)) }));
  }, [filtered, groupBy]);

  React.useEffect(() => { setHotelPage(0); }, [filtered, groupBy]);

  const pagedGroups = React.useMemo(() => {
    const start = hotelPage * PAGE_SIZE;
    if (groupBy === 'none') return groups.slice(start, start + PAGE_SIZE);
    const allEntries = groups.flatMap(g => g.entries);
    const sliced = allEntries.slice(start, start + PAGE_SIZE);
    const slicedIds = new Set(sliced.map(e => e.hotel.id));
    return groups
      .map(g => ({ ...g, entries: g.entries.filter(e => slicedIds.has(e.hotel.id)) }))
      .filter(g => g.entries.length > 0);
  }, [groups, groupBy, hotelPage]);

  type SummaryCol = { available: number; withImg: number; noImg: number };

  function computeSummaryCols(entriesForGroup: HotelEntry[]): SummaryCol[] {
    return OCCUPANCY_CONFIGS.map(cfg => {
      let available = 0, withImg = 0, noImg = 0;
      for (const e of entriesForGroup) {
        const result = e.playwrightResults?.[cfg.folder];
        if (!result || result.error) continue;
        for (const r of result.rooms ?? []) {
          available++;
          if (r.imageMissing) noImg++; else withImg++;
        }
      }
      return { available, withImg, noImg };
    });
  }

  type HotelImgStatus = 'all' | 'partial' | 'none';

  function hotelImgStatus(entry: HotelEntry, folder: string): HotelImgStatus | null {
    const rooms = entry.playwrightResults?.[folder]?.rooms;
    if (!rooms || rooms.length === 0) return null;
    const noImgCount = rooms.filter(r => r.imageMissing).length;
    if (noImgCount === 0) return 'all';
    if (noImgCount === rooms.length) return 'none';
    return 'partial';
  }

  function computeHotelStatusCols(entriesForGroup: HotelEntry[]) {
    return OCCUPANCY_CONFIGS.map(cfg => {
      let all = 0, partial = 0, none = 0, noData = 0;
      for (const e of entriesForGroup) {
        const s = hotelImgStatus(e, cfg.folder);
        if (s === 'all') all++;
        else if (s === 'partial') partial++;
        else if (s === 'none') none++;
        else noData++;
      }
      return { all, partial, none, noData };
    });
  }

  const hotelSummary = React.useMemo(() => {
    if (groupBy === 'none') return { type: 'flat' as const, cols: computeHotelStatusCols(filtered) };
    const totalCols = computeHotelStatusCols(filtered);
    const groupRows = groups.map(g => ({ name: g.label, cols: computeHotelStatusCols(g.entries) }));
    return { type: 'grouped' as const, totalCols, groupRows };
  }, [groups, groupBy, filtered]);

  const scanSummary = React.useMemo(() => {
    if (groupBy === 'none') return { type: 'flat' as const, cols: computeSummaryCols(filtered) };
    const totalCols = computeSummaryCols(filtered);
    const groupRows = groups.map(g => ({ name: g.label, cols: computeSummaryCols(g.entries) }));
    return { type: 'grouped' as const, totalCols, groupRows };
  }, [groups, groupBy, filtered]);

  const allVisibleIds = React.useMemo(() => filtered.map(e => e.hotel.id), [filtered]);
  const anyExpanded = allVisibleIds.some(id => expandedHotels.has(id));

  function toggleExpandAll() {
    setExpandedHotels(anyExpanded ? new Set() : new Set(allVisibleIds));
  }

  function toggleHotel(hotelId: number) {
    setExpandedHotels(prev => {
      const next = new Set(prev);
      next.has(hotelId) ? next.delete(hotelId) : next.add(hotelId);
      return next;
    });
  }

  function toggleOcc(hotelId: number, label: string) {
    setExpandedOcc(prev => {
      const next = new Map(prev);
      const set = new Set(next.get(hotelId) ?? []);
      set.has(label) ? set.delete(label) : set.add(label);
      next.set(hotelId, set);
      return next;
    });
  }

  // ── Load scan history ──────────────────────────────────────────────────────
  const loadScans = React.useCallback(async () => {
    try {
      const list = await fetchJSON('/api/playwright-scan/scans', { cache: 'no-store' });
      if (Array.isArray(list)) setScans(list);
    } catch { /* non-fatal */ }
  }, []);

  React.useEffect(() => { loadScans(); }, [loadScans]);

  // Load active+bookable hotels for scan-start selector
  React.useEffect(() => {
    setScanHotelsLoading(true);
    fetchJSON('/api/hotels?active=1&bookable=1', { cache: 'no-store' })
      .then(d => {
        const list = Array.isArray(d) ? d : [];
        setScanHotels(list);
        setScanHotelIds(list.map((h: { id: number }) => h.id));
      })
      .catch(() => setScanHotelsLoadError('Failed to load hotels.'))
      .finally(() => setScanHotelsLoading(false));
  }, []);

  // Auto-select most recent done scan
  React.useEffect(() => {
    if (scans.length > 0 && selectedScanId === null) {
      const done = scans.find(s => s.status === 'done');
      if (done) setSelectedScanId(done.id);
    }
  }, [scans, selectedScanId]);

  // ── Load hotel data ────────────────────────────────────────────────────────
  const loadEntries = React.useCallback(async (scanId: number | null) => {
    setLoadingEntries(true);
    setEntriesError(null);
    try {
      const url = scanId !== null ? `/api/rooms-cr-api?playwrightScanId=${scanId}` : '/api/rooms-cr-api';
      const data = await fetchJSON(url, { cache: 'no-store' });
      const loaded: HotelEntry[] = Array.isArray(data) ? data : [];
      setEntries(loaded);
      setExpandedHotels(new Set(loaded.map(e => e.hotel.id)));
    } catch (e: unknown) {
      setEntriesError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoadingEntries(false);
    }
  }, []);

  React.useEffect(() => {
    setSelectedHotelIds([]);
    loadEntries(selectedScanId);
  }, [selectedScanId, loadEntries]);

  // ── Polling for active scan ────────────────────────────────────────────────
  React.useEffect(() => {
    if (activeScanId === null) return;
    const interval = setInterval(async () => {
      try {
        const data: PlaywrightScan = await fetchJSON(`/api/playwright-scan?scanId=${activeScanId}`, { cache: 'no-store' });
        setActiveScanStatus(data);
        if (data.status === 'done' || data.status === 'cancelled') {
          clearInterval(interval);
          setActiveScanId(null);
          await loadScans();
          setSelectedScanId(data.id);
        }
      } catch { /* ignore transient */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [activeScanId, loadScans]);

  // ── Start scan ────────────────────────────────────────────────────────────
  async function startScan() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch('/api/playwright-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkIn, takeScreenshot, hotelIds: scanHotelIds }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
      const { scanId, total } = json as { scanId: number; total: number };
      setActiveScanId(scanId);
      setActiveScanStatus({
        id: scanId, check_in: checkIn, take_screenshot: takeScreenshot,
        status: 'running', total, processed: 0, errors: 0,
        created_at: new Date().toISOString(), finished_at: null,
      });
      await loadScans();
    } catch (e: unknown) {
      setStartError(e instanceof Error ? e.message : 'Failed to start scan');
    } finally {
      setStarting(false);
    }
  }

  async function retryScan(scanId: number) {
    setRetryingScanId(scanId);
    setRetryError(null);
    try {
      const res = await fetch('/api/playwright-scan/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
      setActiveScanId(scanId);
      await loadScans();
    } catch (e: unknown) {
      setRetryError(e instanceof Error ? e.message : 'Failed to retry');
    } finally {
      setRetryingScanId(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const isScanning = activeScanId !== null;
  const scanPct = activeScanStatus && activeScanStatus.total > 0
    ? Math.round(((activeScanStatus.processed + activeScanStatus.errors) / activeScanStatus.total) * 100)
    : 0;

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>
        <h4 className="mb-3">Rooms / CR-API</h4>

        {/* ── Scan trigger card ── */}
        <div className="card mb-4">
          <div className="card-header fw-semibold">TUI-Hotels Rooms Scan</div>
          <div className="card-body">
            {startError && (
              <div className="alert alert-danger alert-dismissible py-2" role="alert">
                {startError}
                <button type="button" className="btn-close" onClick={() => setStartError(null)} />
              </div>
            )}
            {!isScanning && (
              <div className="row g-3 align-items-end">
                <div className="col-12">
                  <ScanHotelSelector hotels={scanHotels} loading={scanHotelsLoading} loadError={scanHotelsLoadError} selectedIds={scanHotelIds} onChange={setScanHotelIds} />
                </div>
                <div className="col-sm-auto">
                  <label className="form-label fw-semibold">Check-In Date</label>
                  <input type="date" className="form-control form-control-sm" value={checkIn} onChange={e => setCheckIn(e.target.value)} />
                </div>
                <div className="col-sm-auto d-flex align-items-end pb-1">
                  <div className="form-check">
                    <input type="checkbox" id="takeScreenshot" className="form-check-input" checked={takeScreenshot} onChange={e => setTakeScreenshot(e.target.checked)} />
                    <label className="form-check-label" htmlFor="takeScreenshot">Take Screenshots</label>
                  </div>
                </div>
                <div className="col-sm-auto">
                  <button type="button" className="btn btn-sm btn-primary" onClick={startScan} disabled={starting || !checkIn || scanHotelIds.length === 0}>
                    {starting ? (<><span className="spinner-border spinner-border-sm me-1" />Starting…</>) : `Start Scan (${scanHotelIds.length} of ${scanHotels.length})`}
                  </button>
                </div>
              </div>
            )}
            {isScanning && activeScanStatus && (
              <div>
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <span className="small fw-semibold">
                    Scanning… {activeScanStatus.processed + activeScanStatus.errors} / {activeScanStatus.total} processed
                    {activeScanStatus.errors > 0 && <span className="text-danger ms-2">({activeScanStatus.errors} errors)</span>}
                  </span>
                  <span className="small text-muted">{scanPct}%</span>
                </div>
                <div className="progress" style={{ height: 8 }}>
                  <div className="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style={{ width: `${scanPct}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Filters & grouping toolbar ── */}
        <div className="card mb-3">
          <div className="card-body py-2">
            <div className="d-flex align-items-end gap-3 pb-2 mb-2 border-bottom">
              <div>
                <label htmlFor="scan-select" className="form-label form-label-sm mb-1 fw-semibold">Scan</label>
                <select id="scan-select" className="form-select form-select-sm" style={{ minWidth: 260 }} value={selectedScanId ?? ''} onChange={e => setSelectedScanId(Number(e.target.value) || null)}>
                  <option value="">— no scan selected —</option>
                  {scans.map(s => <option key={s.id} value={s.id}>#{s.id} — {s.check_in} — {s.status} ({s.processed}/{s.total})</option>)}
                </select>
              </div>
              {(() => {
                const sel = scans.find(s => s.id === selectedScanId);
                if (!sel || sel.status === 'running' || sel.errors === 0) return null;
                return (
                  <div className="align-self-end">
                    <button type="button" className="btn btn-sm btn-outline-warning" disabled={retryingScanId === sel.id} onClick={() => retryScan(sel.id)}>
                      {retryingScanId === sel.id ? 'Re-queuing…' : `⟳ Retry ${sel.errors} error${sel.errors !== 1 ? 's' : ''}`}
                    </button>
                    {retryError && <div className="text-danger small mt-1">{retryError}</div>}
                  </div>
                );
              })()}
              <span className="small text-muted align-self-end pb-1">{entries.length} hotel{entries.length !== 1 ? 's' : ''}{filtered.length !== entries.length ? ` (${filtered.length} shown)` : ''}</span>
              {filtered.length > 0 && (
                <button type="button" className="btn btn-sm btn-outline-secondary ms-auto align-self-end" onClick={toggleExpandAll}>
                  {anyExpanded ? 'Collapse All' : 'Expand All'}
                </button>
              )}
            </div>
            <div className="d-flex flex-wrap align-items-end gap-3">
              <div>
                <div className="form-label form-label-sm mb-1 fw-semibold">Hotels</div>
                <HotelCombobox hotels={allHotels} selectedIds={selectedHotelIds} onChange={setSelectedHotelIds} size="sm" />
              </div>
              <div>
                <div className="form-label form-label-sm mb-1 fw-semibold">Group by</div>
                <div className="btn-group btn-group-sm" role="group">
                  {(['none', 'brand', 'region', 'country'] as GroupBy[]).map(g => (
                    <button key={g} type="button" className={`btn btn-outline-secondary${groupBy === g ? ' active' : ''}`} onClick={() => setGroupBy(g)}>
                      {g === 'none' ? 'Per Hotel' : g.charAt(0).toUpperCase() + g.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="d-flex align-items-center gap-1 mb-1">
                  <span className="form-label form-label-sm fw-semibold mb-0">Filter</span>
                  <FilterHelpButton />
                </div>
                <div className="btn-group btn-group-sm" role="group">
                  <button type="button" className={`btn btn-outline-secondary${attentionFilter === 'all' ? ' active' : ''}`} onClick={() => setAttentionFilter('all')}>All</button>
                  <button type="button" className={`btn btn-outline-secondary${attentionFilter === 'attention' ? ' active' : ''}`} onClick={() => setAttentionFilter(attentionFilter === 'attention' ? 'all' : 'attention')}>⚠ Attention needed</button>
                  <button type="button" className={`btn btn-outline-secondary${attentionFilter === 'fixable' ? ' active' : ''}`} onClick={() => { setAttentionFilter(attentionFilter === 'fixable' ? 'all' : 'fixable'); setFixPotentialOverrides(new Map()); }}>⚡ Fix potential</button>
                </div>
              </div>
              <div>
                <div className="d-flex align-items-center gap-1 mb-1">
                  <span className="form-label form-label-sm fw-semibold mb-0">Mapping quality</span>
                  <QualityHelpButton />
                </div>
                <div className="btn-group btn-group-sm flex-wrap" role="group">
                  <button type="button" className={`btn btn-outline-secondary${qualityFilter === 'all' ? ' active' : ''}`} onClick={() => setQualityFilter('all')}>All</button>
                  {(['perfect', 'verygood', 'good', 'mediocre', 'poor', 'horrible', 'unavailable'] as Quality[]).map(q => (
                    <button key={q} type="button" className={`btn btn-outline-secondary${qualityFilter === q ? ' active' : ''}`} onClick={() => setQualityFilter(qualityFilter === q ? 'all' : q)}>{QUALITY_LABELS[q]}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Summary ── */}
        {!loadingEntries && entries.length > 0 && entries.some(e => e.playwrightResults) && (
          <div className="card mb-4">
            <div className="card-header fw-semibold d-flex align-items-center gap-2" style={{ cursor: 'pointer' }} onClick={() => setSummaryOpen(o => !o)} role="button" aria-expanded={summaryOpen}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0, transition: 'transform 0.15s ease', transform: summaryOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                <path fillRule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
              </svg>
              Scan Summary
            </div>
            {summaryOpen && <div className="card-body p-0">
              <div className="px-3 pt-3 pb-1 small text-muted fw-semibold">Room counts</div>
              <table className="table table-sm table-bordered mb-0 small">
                <thead className="table-light">
                  <tr><th style={{ width: '22%' }}></th>{OCCUPANCY_CONFIGS.map(cfg => <th key={cfg.folder} className="text-center">{cfg.label}</th>)}</tr>
                </thead>
                <tbody>
                  {scanSummary.type === 'flat' ? (<>
                    <tr><td className="fw-semibold">Available rooms</td>{scanSummary.cols.map((c, i) => <td key={i} className="text-center">{c.available}</td>)}</tr>
                    <tr><td className="fw-semibold text-danger">Rooms w/o image</td>{scanSummary.cols.map((c, i) => <td key={i} className="text-center">{c.noImg}</td>)}</tr>
                    <tr><td className="fw-bold text-success">Rooms w/ image</td>{scanSummary.cols.map((c, i) => <td key={i} className="text-center fw-bold">{c.withImg}</td>)}</tr>
                  </>) : (<>
                    <tr><td className="fw-semibold">Available rooms (total)</td>{scanSummary.totalCols.map((c, i) => <td key={i} className="text-center">{c.available}</td>)}</tr>
                    <tr><td className="fw-semibold text-danger">Rooms w/o image (total)</td>{scanSummary.totalCols.map((c, i) => <td key={i} className="text-center">{c.noImg}</td>)}</tr>
                    <tr><td className="fw-bold text-success">Rooms w/ image (total)</td>{scanSummary.totalCols.map((c, i) => <td key={i} className="text-center fw-bold">{c.withImg}</td>)}</tr>
                    {scanSummary.groupRows.map(g => (
                      <React.Fragment key={g.name}>
                        <tr className="table-secondary"><td colSpan={OCCUPANCY_CONFIGS.length + 1} className="fw-semibold small py-1">{g.name}</td></tr>
                        <tr><td className="ps-3 text-muted">Available rooms</td>{g.cols.map((c, i) => <td key={i} className="text-center">{c.available}</td>)}</tr>
                        <tr><td className="ps-3 text-danger">Rooms w/o image</td>{g.cols.map((c, i) => <td key={i} className="text-center">{c.noImg}</td>)}</tr>
                        <tr><td className="ps-3 text-success fw-bold">Rooms w/ image</td>{g.cols.map((c, i) => <td key={i} className="text-center fw-bold">{c.withImg}</td>)}</tr>
                      </React.Fragment>
                    ))}
                  </>)}
                </tbody>
              </table>

              <div className="px-3 pt-3 pb-1 small text-muted fw-semibold">Hotels by image status</div>
              <table className="table table-sm table-bordered mb-0 small">
                <thead className="table-light">
                  <tr><th style={{ width: '22%' }}></th>{OCCUPANCY_CONFIGS.map(cfg => <th key={cfg.folder} className="text-center">{cfg.label}</th>)}</tr>
                </thead>
                <tbody>
                  {hotelSummary.type === 'flat' ? (<>
                    <tr><td className="fw-semibold text-success">All images</td>{hotelSummary.cols.map((c, i) => <td key={i} className="text-center">{c.all}</td>)}</tr>
                    <tr><td className="fw-semibold text-warning-emphasis">Partial</td>{hotelSummary.cols.map((c, i) => <td key={i} className="text-center">{c.partial}</td>)}</tr>
                    <tr><td className="fw-semibold text-danger">No images</td>{hotelSummary.cols.map((c, i) => <td key={i} className="text-center">{c.none}</td>)}</tr>
                    {hotelSummary.cols.some(c => c.noData > 0) && (
                      <tr><td className="text-muted">No data</td>{hotelSummary.cols.map((c, i) => <td key={i} className="text-center text-muted">{c.noData}</td>)}</tr>
                    )}
                  </>) : (<>
                    <tr><td className="fw-bold text-success">All images (total)</td>{hotelSummary.totalCols.map((c, i) => <td key={i} className="text-center fw-bold">{c.all}</td>)}</tr>
                    <tr><td className="fw-semibold text-warning-emphasis">Partial (total)</td>{hotelSummary.totalCols.map((c, i) => <td key={i} className="text-center">{c.partial}</td>)}</tr>
                    <tr><td className="fw-semibold text-danger">No images (total)</td>{hotelSummary.totalCols.map((c, i) => <td key={i} className="text-center">{c.none}</td>)}</tr>
                    {hotelSummary.totalCols.some(c => c.noData > 0) && (
                      <tr><td className="text-muted">No data (total)</td>{hotelSummary.totalCols.map((c, i) => <td key={i} className="text-center text-muted">{c.noData}</td>)}</tr>
                    )}
                    {hotelSummary.groupRows.map(g => (
                      <React.Fragment key={g.name}>
                        <tr className="table-secondary"><td colSpan={OCCUPANCY_CONFIGS.length + 1} className="fw-semibold small py-1">{g.name}</td></tr>
                        <tr><td className="ps-3 text-success">All images</td>{g.cols.map((c, i) => <td key={i} className="text-center">{c.all}</td>)}</tr>
                        <tr><td className="ps-3 text-warning-emphasis">Partial</td>{g.cols.map((c, i) => <td key={i} className="text-center">{c.partial}</td>)}</tr>
                        <tr><td className="ps-3 text-danger">No images</td>{g.cols.map((c, i) => <td key={i} className="text-center">{c.none}</td>)}</tr>
                        {g.cols.some(c => c.noData > 0) && (
                          <tr><td className="ps-3 text-muted">No data</td>{g.cols.map((c, i) => <td key={i} className="text-center text-muted">{c.noData}</td>)}</tr>
                        )}
                      </React.Fragment>
                    ))}
                  </>)}
                </tbody>
              </table>
              <div style={{ height: 1 }} />
            </div>}
          </div>
        )}

        {/* ── Loading ── */}
        {loadingEntries && (
          <div className="text-center py-5">
            <div className="spinner-border text-secondary" role="status"><span className="visually-hidden">Loading…</span></div>
          </div>
        )}
        {entriesError && <div className="alert alert-danger" role="alert">{entriesError}</div>}

        {/* ── Pagination (top) ── */}
        {!loadingEntries && filtered.length > PAGE_SIZE && (
          <div className="d-flex align-items-center justify-content-between mb-3">
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={hotelPage === 0} onClick={() => setHotelPage(p => p - 1)}>← Prev</button>
            <span className="small text-muted">{hotelPage * PAGE_SIZE + 1}–{Math.min((hotelPage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={(hotelPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => setHotelPage(p => p + 1)}>Next →</button>
          </div>
        )}

        {/* ── Hotel cards ── */}
        {!loadingEntries && pagedGroups.map(group => (
          <div key={group.key}>
            {groupBy !== 'none' && (
              <div className="d-flex align-items-center gap-2 mb-2 mt-3">
                <h6 className="mb-0 fw-bold">{group.label}</h6>
                <span className="badge bg-secondary fw-normal">{group.entries.length}</span>
              </div>
            )}
            {group.entries.map(entry => {
              const isOpen = expandedHotels.has(entry.hotel.id);
              const mappingRows = entry.playwrightResults !== null ? buildMapping(entry.crRooms, entry.playwrightResults) : null;
              const matched  = mappingRows ? mappingRows.filter(r => r.inBoth).length : 0;
              const crOnly   = mappingRows ? mappingRows.filter(r => r.inCr && !r.inScan).length : 0;
              const scanOnly = mappingRows ? mappingRows.filter(r => !r.inCr && r.inScan).length : 0;

              return (
                <div key={entry.hotel.id} className="card mb-2">
                  <div className="card-header fw-semibold d-flex align-items-center gap-2 flex-wrap" style={{ cursor: 'pointer' }} onClick={() => toggleHotel(entry.hotel.id)} role="button" aria-expanded={isOpen}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0, transition: 'transform 0.15s ease', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                      <path fillRule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
                    </svg>
                    <span>
                      {entry.hotel.name}
                      <span className="ms-2 text-muted fw-normal small">{entry.hotel.code}</span>
                      {entry.hotel.brand && <span className="ms-2 badge bg-light text-dark fw-normal">{entry.hotel.brand}</span>}
                      {entry.hotel.region && <span className="ms-1 text-muted fw-normal small">{entry.hotel.region}{entry.hotel.country ? `, ${entry.hotel.country}` : ''}</span>}
                    </span>
                    {mappingRows !== null && <span className="text-muted fw-normal small ms-2">{matched} matched · {crOnly} CR-API only · {scanOnly} scan only</span>}
                    <span className="ms-auto d-flex gap-2 align-items-center">
                      {hasAttention(entry) && <span className="badge bg-warning text-dark">⚠ attention</span>}
                      {isEntryFixable(entry) && <span className="badge bg-info text-dark">⚡ fixable</span>}
                      {(() => { const q = computeQuality(entry); return q ? <span className={`badge bg-${QUALITY_COLORS[q]}${q === 'mediocre' || q === 'poor' ? ' text-dark' : ''} fw-normal`}>{QUALITY_LABELS[q]}</span> : null; })()}
                      <span className="badge bg-primary fw-normal">CR-API: {entry.crRooms.length}</span>
                    </span>
                  </div>

                  {isOpen && (
                    <div className="card-body">
                      <RoomsPanel hotelId={entry.hotel.id} hotelName={entry.hotel.name} crRooms={entry.crRooms} playwrightResults={entry.playwrightResults} expandedOcc={expandedOcc} toggleOcc={toggleOcc} />
                      {(entry.crRooms.length > 0 || entry.playwrightResults !== null) && mappingRows !== null && (
                        <>
                          <hr className="my-2" style={{ opacity: 0.3 }} />
                          <MappingTable
                            rows={mappingRows}
                            fixPotentialActive={fixPotentialOverrides.has(entry.hotel.id) ? fixPotentialOverrides.get(entry.hotel.id)! : attentionFilter === 'fixable'}
                            onFixPotentialToggle={() => {
                              setFixPotentialOverrides(prev => {
                                const next = new Map(prev);
                                const current = prev.has(entry.hotel.id) ? prev.get(entry.hotel.id)! : attentionFilter === 'fixable';
                                next.set(entry.hotel.id, !current);
                                return next;
                              });
                            }}
                          />
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* ── Pagination (bottom) ── */}
        {!loadingEntries && filtered.length > PAGE_SIZE && (
          <div className="d-flex align-items-center justify-content-between mt-2 mb-4">
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={hotelPage === 0} onClick={() => { setHotelPage(p => p - 1); window.scrollTo({ top: 0 }); }}>← Prev</button>
            <span className="small text-muted">{hotelPage * PAGE_SIZE + 1}–{Math.min((hotelPage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={(hotelPage + 1) * PAGE_SIZE >= filtered.length} onClick={() => { setHotelPage(p => p + 1); window.scrollTo({ top: 0 }); }}>Next →</button>
          </div>
        )}

        {!loadingEntries && filtered.length === 0 && !entriesError && (
          <p className="text-muted">{entries.length === 0 ? 'No data loaded yet.' : 'No hotels match the current filters.'}</p>
        )}
      </div>
    </main>
  );
}
