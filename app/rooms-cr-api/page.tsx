'use client';

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';
import { HotelCombobox } from '@/app/components/HotelCombobox';
import { OCCUPANCY_CONFIGS } from '@/lib/playwright-scan-helpers';

// ── Types ─────────────────────────────────────────────────────────────────────

type PlaywrightScan = {
  id: number;
  check_in: string;
  take_screenshot: boolean;
  status: string;
  total: number;
  processed: number;
  errors: number;
  created_at: string;
  finished_at: string | null;
};

type CrRoom = {
  hotel_id: number;
  name: string;
  room_code: string | null;
  global_types: string[] | null;
  image_url: string | null;
};

type PlaywrightOccResult = {
  hotel_id: number;
  occupancy: string;
  rooms: Array<{ roomId: string; roomCode: string; roomName: string; imageMissing: boolean }> | null;
  screenshot_url: string | null;
  error: string | null;
};

type HotelEntry = {
  hotel: { id: number; name: string; code: string; brand: string | null; region: string | null; country: string | null };
  crRooms: CrRoom[];
  playwrightScanId: number | null;
  playwrightResults: Record<string, PlaywrightOccResult> | null;
};

type GroupBy = 'none' | 'brand' | 'region';
type AttentionFilter = 'all' | 'attention' | 'fixable';
type Quality = 'perfect' | 'verygood' | 'good' | 'mediocre' | 'poor' | 'horrible';
type QualityFilter = 'all' | Quality;

function hasAttention(entry: HotelEntry): boolean {
  if (!entry.playwrightResults) return false;
  return Object.values(entry.playwrightResults).some(r => r.rooms?.some(rm => rm.imageMissing));
}

function isFixable(entry: HotelEntry): boolean {
  if (!entry.playwrightResults) return false;
  const rows = buildMapping(entry.crRooms, entry.playwrightResults);
  const hasScanNoImage   = rows.some(r => r.inScan && !r.imgScan);
  const hasCrOnlyWithImg = rows.some(r => r.inCr && !r.inScan && r.imgCr);
  return hasScanNoImage && hasCrOnlyWithImg;
}

function computeQuality(entry: HotelEntry): Quality | null {
  if (!entry.playwrightResults) return null;

  // Deduplicate scan rooms across all occupancies; keyed by roomCode || roomName.
  // hasImage = true if !imageMissing in any occupancy.
  const scanRooms = new Map<string, { roomName: string; hasImage: boolean }>();
  for (const result of Object.values(entry.playwrightResults)) {
    for (const r of result.rooms ?? []) {
      const key = r.roomCode || r.roomName;
      const hasImage = !r.imageMissing;
      const existing = scanRooms.get(key);
      if (!existing || hasImage) {
        scanRooms.set(key, { roomName: r.roomName, hasImage: hasImage || (existing?.hasImage ?? false) });
      }
    }
  }
  if (scanRooms.size === 0) return null;

  const withImg = [...scanRooms.values()].filter(r => r.hasImage).length;
  const ratio = withImg / scanRooms.size;

  if (withImg === 0) return 'horrible';
  if (ratio < 0.5) return 'poor';
  if (withImg < scanRooms.size) return 'mediocre';

  // All scan rooms have images — check CR-API coverage (only rooms WITH image count).
  // Keyed by room_code || name, same logic as buildMapping.
  const crWithImg = new Map<string, string>(); // key → name
  for (const r of entry.crRooms) {
    if (r.image_url) crWithImg.set(r.room_code || r.name, r.name);
  }

  // Good: any CR-API-with-image room not found in scan keys
  const scanKeys = new Set(scanRooms.keys());
  const hasUnmappedCrWithImg = [...crWithImg.keys()].some(k => !scanKeys.has(k));
  if (hasUnmappedCrWithImg) return 'good';

  // Perfect vs Very good: for all matched pairs (same key in both), do names match?
  let allMatchedNamesEqual = true;
  for (const [key, scan] of scanRooms) {
    const crName = crWithImg.get(key);
    if (crName !== undefined && crName.trim().toLowerCase() !== scan.roomName.trim().toLowerCase()) {
      allMatchedNamesEqual = false;
      break;
    }
  }
  return allMatchedNamesEqual ? 'perfect' : 'verygood';
}

const QUALITY_LABELS: Record<Quality, string> = {
  perfect:  'Perfect',
  verygood: 'Very good',
  good:     'Good',
  mediocre: 'Mediocre',
  poor:     'Poor',
  horrible: 'Horrible',
};

const QUALITY_COLORS: Record<Quality, string> = {
  perfect:  'success',
  verygood: 'primary',
  good:     'info',
  mediocre: 'warning',
  poor:     'orange',
  horrible: 'danger',
};

const QUALITY_DESCRIPTIONS: Record<Quality, string> = {
  perfect:  'All scan rooms have images; all matched names equal CR-API names; no unmapped CR-API rooms with images',
  verygood: 'All scan rooms have images; no unmapped CR-API rooms with images; names may differ',
  good:     'All scan rooms have images; unmapped CR-API rooms with images exist',
  mediocre: '≥50% of scan rooms have images; at least 1 missing',
  poor:     '<50% of scan rooms have images; at least 1 present',
  horrible: 'No scan room has an image',
};

// ── Quality help popup ────────────────────────────────────────────────────────

function QualityHelpButton() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="What do quality levels mean?"
        aria-expanded={open}
        style={{
          width: 16, height: 16, padding: 0, fontSize: '0.65rem', lineHeight: 1,
          border: '1px solid currentColor', borderRadius: '50%',
          background: 'transparent', cursor: 'pointer', color: 'var(--bs-secondary)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        ?
      </button>
      {open && (
        <div style={{
          position: 'absolute', zIndex: 1060, top: '120%', left: 0,
          minWidth: 340, background: 'var(--bs-body-bg)',
          border: '1px solid var(--bs-border-color)', borderRadius: '0.375rem',
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: '0.6rem 0.75rem',
        }}>
          <div className="d-flex align-items-center justify-content-between mb-2">
            <span className="small fw-semibold">Mapping quality levels</span>
            <button
              type="button"
              className="btn-close btn-close-sm"
              aria-label="Close"
              onClick={() => setOpen(false)}
              style={{ fontSize: '0.65rem' }}
            />
          </div>
          <ul className="list-unstyled mb-0 small">
            {(['perfect', 'verygood', 'good', 'mediocre', 'poor', 'horrible'] as Quality[]).map(q => (
              <li key={q} className="mb-1">
                <span className="fw-semibold">{QUALITY_LABELS[q]}:</span>{' '}
                <span className="text-muted">{QUALITY_DESCRIPTIONS[q]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Combined Rooms panel (CR-API + Amello Rooms, collapsible) ────────────────

function RoomsPanel({
  hotelId, hotelName, crRooms, playwrightResults, expandedOcc, toggleOcc,
}: {
  hotelId: number;
  hotelName: string;
  crRooms: CrRoom[];
  playwrightResults: Record<string, PlaywrightOccResult> | null;
  expandedOcc: Map<number, Set<string>>;
  toggleOcc: (hotelId: number, label: string) => void;
}) {
  const [open, setOpen] = React.useState(false);

  const withImage    = crRooms.filter(r => r.image_url);
  const withoutImage = crRooms.filter(r => !r.image_url);

  function CrTable({ rows }: { rows: CrRoom[] }) {
    return (
      <table className="table table-sm table-bordered mb-0 small">
        <thead className="table-light">
          <tr><th style={{ width: '25%' }}>Code</th><th>Name</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="font-monospace text-muted">{r.room_code || '—'}</td>
              <td>{r.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="btn btn-link btn-sm text-start p-0 fw-semibold text-decoration-none small"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        Rooms {open ? '▲' : '▼'}
      </button>

      {open && (
        <div className="mt-2 d-flex flex-column gap-3">
          {/* CR-API rooms */}
          <div>
            <div className="small fw-semibold text-muted mb-1">CR-API Rooms ({crRooms.length})</div>
            {crRooms.length === 0 ? (
              <p className="text-muted small mb-0">No CR-API rooms synced</p>
            ) : (
              <div className="d-flex flex-column gap-2">
                {withImage.length > 0 && (
                  <div>
                    <div className="small text-success mb-1">With image ({withImage.length})</div>
                    <CrTable rows={withImage} />
                  </div>
                )}
                {withoutImage.length > 0 && (
                  <div>
                    <div className="small text-danger mb-1">Without image ({withoutImage.length})</div>
                    <CrTable rows={withoutImage} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Amello Rooms (scan results per occupancy) */}
          <div>
            <div className="small fw-semibold text-muted mb-1">Amello Rooms</div>
            {playwrightResults === null ? (
              <p className="text-muted small mb-0">No scan data — run a scan above</p>
            ) : (
              <div className="accordion accordion-flush" id={`acc-${hotelId}`}>
                {OCCUPANCY_CONFIGS.map(occ => {
                  const result = playwrightResults?.[occ.folder] ?? null;
                  const isOccOpen = expandedOcc.get(hotelId)?.has(occ.label) ?? false;
                  return (
                    <div key={occ.label} className="accordion-item">
                      <h2 className="accordion-header">
                        <button
                          className={`accordion-button py-2 small${isOccOpen ? '' : ' collapsed'}`}
                          type="button"
                          onClick={() => toggleOcc(hotelId, occ.label)}
                        >
                          <span className="me-2">{occ.label}</span>
                          {result && !result.error && result.rooms !== null && (
                            <span className="badge bg-secondary fw-normal">{result.rooms.length} rooms</span>
                          )}
                          {result?.error && <span className="badge bg-danger fw-normal">Error</span>}
                          {!result && <span className="badge bg-light text-muted fw-normal">Not scanned</span>}
                        </button>
                      </h2>
                      {isOccOpen && (
                        <div className="accordion-collapse">
                          <div className="accordion-body py-2 px-3">
                            {!result ? (
                              <p className="text-muted small mb-0">Not scanned</p>
                            ) : result.error ? (
                              <p className="text-danger small mb-0">{result.error}</p>
                            ) : result.rooms && result.rooms.length > 0 ? (
                              <table className="table table-sm table-bordered mb-0 small">
                                <thead className="table-light">
                                  <tr>
                                    <th style={{ width: '22%' }}>Code</th>
                                    <th>Room name</th>
                                    <th className="text-center" style={{ width: 80 }}>Image</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {result.rooms.map((r, i) => (
                                    <tr key={i}>
                                      <td className="font-monospace text-muted">{r.roomCode || '—'}</td>
                                      <td>{r.roomName}</td>
                                      <td className="text-center">
                                        {r.imageMissing
                                          ? <span className="text-danger fw-semibold">No</span>
                                          : <span className="text-success fw-semibold">Yes</span>}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <p className="text-muted small mb-0">No rooms found</p>
                            )}
                            {result?.screenshot_url && (
                              <div className="mt-2">
                                <img src={result.screenshot_url} alt={`${hotelName} ${occ.label}`} style={{ width: '100%', borderRadius: 4 }} />
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Mapping table helpers ─────────────────────────────────────────────────────

type MappingRow = {
  key:      string;
  crCode:   string;
  scanCode: string;
  crName:   string;
  scanName: string;
  inCr:     boolean;
  inScan:   boolean;
  inBoth:   boolean;
  imgCr:    boolean;
  imgScan:  boolean;
  imgBoth:  boolean;
};

function buildMapping(crRooms: CrRoom[], playwrightResults: Record<string, PlaywrightOccResult> | null): MappingRow[] {
  // Deduplicate scan rooms across all occupancies: a room "has image" if !imageMissing in any occ
  const scanRoomMap = new Map<string, { roomCode: string; roomName: string; hasImage: boolean }>();
  for (const result of Object.values(playwrightResults ?? {})) {
    for (const r of result.rooms ?? []) {
      const key = r.roomCode || r.roomName;
      const existing = scanRoomMap.get(key);
      const hasImage = !r.imageMissing;
      if (!existing || hasImage) {
        scanRoomMap.set(key, { roomCode: r.roomCode, roomName: r.roomName, hasImage: hasImage || (existing?.hasImage ?? false) });
      }
    }
  }

  // CR-API: image map and name→code map
  const crImgMap = new Map<string, boolean>();
  const crNameToKey = new Map<string, string>();
  for (const r of crRooms) {
    const key = r.room_code || r.name;
    crImgMap.set(key, !!r.image_url);
    if (r.room_code) crNameToKey.set(r.name.trim().toLowerCase(), r.room_code);
  }

  const allCodes = new Map<string, { crCode: string; scanCode: string; crName: string; scanName: string; inCr: boolean; inScan: boolean; imgCr: boolean; imgScan: boolean }>();

  for (const r of crRooms) {
    const key = r.room_code || r.name;
    if (!allCodes.has(key)) allCodes.set(key, { crCode: '', scanCode: '', crName: '', scanName: '', inCr: false, inScan: false, imgCr: false, imgScan: false });
    const entry = allCodes.get(key)!;
    entry.crCode = r.room_code ?? '';
    entry.crName = r.name;
    entry.inCr   = true;
    entry.imgCr  = !!r.image_url;
  }

  for (const [key, data] of scanRoomMap) {
    const resolvedKey = (!data.roomCode && crNameToKey.has(data.roomName.trim().toLowerCase()))
      ? crNameToKey.get(data.roomName.trim().toLowerCase())!
      : key;
    if (!allCodes.has(resolvedKey)) allCodes.set(resolvedKey, { crCode: '', scanCode: '', crName: '', scanName: '', inCr: false, inScan: false, imgCr: false, imgScan: false });
    const entry = allCodes.get(resolvedKey)!;
    entry.scanCode = data.roomCode;
    entry.scanName = data.roomName;
    entry.inScan   = true;
    entry.imgScan  = data.hasImage;
  }

  return [...allCodes.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, d]) => ({
      key,
      crCode:   d.crCode,
      scanCode: d.scanCode,
      crName:   d.crName,
      scanName: d.scanName,
      inCr:     d.inCr,
      inScan:   d.inScan,
      inBoth:   d.inCr && d.inScan,
      imgCr:    d.imgCr,
      imgScan:  d.imgScan,
      imgBoth:  d.imgCr && d.imgScan,
    }));
}

type MatchFilter  = 'all' | 'match' | 'mismatch';
type ImgFilter    = 'all' | 'yes' | 'no';

function MappingTable({ rows }: { rows: MappingRow[] }) {
  const [matchFilter,  setMatchFilter]  = React.useState<MatchFilter>('all');
  const [imgCrFilter,  setImgCrFilter]  = React.useState<ImgFilter>('all');
  const [imgScanFilter, setImgScanFilter] = React.useState<ImgFilter>('all');
  const [fixableOnly,  setFixableOnly]  = React.useState(false);

  const fixableApplicable = rows.some(r => r.inScan && !r.imgScan) && rows.some(r => r.inCr && !r.inScan && r.imgCr);
  const fixableCount = fixableApplicable
    ? rows.filter(r => (r.inCr && !r.inScan && r.imgCr) || (r.inScan && !r.imgScan)).length
    : 0;

  const visible = rows.filter(r => {
    if (fixableOnly) {
      return (r.inCr && !r.inScan && r.imgCr) || (r.inScan && !r.imgScan);
    }
    if (matchFilter === 'match'    && !r.inBoth) return false;
    if (matchFilter === 'mismatch' &&  r.inBoth) return false;
    if (imgCrFilter   === 'yes' && !r.imgCr)   return false;
    if (imgCrFilter   === 'no'  &&  r.imgCr)   return false;
    if (imgScanFilter === 'yes' && !r.imgScan)  return false;
    if (imgScanFilter === 'no'  &&  r.imgScan)  return false;
    return true;
  });

  const inBoth    = rows.filter(r => r.inBoth).length;
  const crOnly    = rows.filter(r => r.inCr  && !r.inScan).length;
  const scanOnly  = rows.filter(r => r.inScan && !r.inCr).length;

  function reset() {
    setMatchFilter('all'); setImgCrFilter('all'); setImgScanFilter('all'); setFixableOnly(false);
  }

  function RadioGroup<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: { val: T; label: string }[]; onChange: (v: T) => void }) {
    return (
      <span className="d-inline-flex gap-2 align-items-center">
        {options.map(o => (
          <label key={o.val} className="d-flex align-items-center gap-1 small" style={{ cursor: 'pointer' }}>
            <input type="radio" name={name} checked={value === o.val} onChange={() => onChange(o.val)} style={{ cursor: 'pointer' }} />
            {o.label}
          </label>
        ))}
      </span>
    );
  }

  const yn = (v: boolean) => v
    ? <span className="text-success fw-semibold">Yes</span>
    : <span className="text-danger">No</span>;

  function matchBadge(r: MappingRow) {
    if (r.inBoth) {
      return <span className="badge bg-success-subtle text-success-emphasis">Both</span>;
    }
    if (r.inCr && !r.inScan) {
      return <span className="badge bg-warning-subtle text-warning-emphasis">CR-API only</span>;
    }
    return <span className="badge bg-danger-subtle text-danger-emphasis">Scan only</span>;
  }

  function rowClass(r: MappingRow): string | undefined {
    if (r.inBoth) return undefined;
    if (r.inCr && !r.inScan) return 'table-warning';
    return 'table-danger';
  }

  return (
    <div>
      <div className="fw-semibold small mb-2">
        Code Mapping — CR-API ↔ Scan
        <span className="ms-2 text-muted fw-normal">({rows.length} codes)</span>
      </div>

      {/* Filters */}
      <div className="d-flex flex-wrap align-items-center gap-3 mb-2 small">
        <span className="d-flex align-items-center gap-2">
          <span className="fw-semibold">Match:</span>
          <RadioGroup name={`match-${rows.length}`} value={matchFilter} options={[{ val: 'all', label: 'All' }, { val: 'match', label: 'Match only' }, { val: 'mismatch', label: 'Missing match' }]} onChange={v => { setMatchFilter(v); setFixableOnly(false); }} />
        </span>
        <span className="d-flex align-items-center gap-2">
          <span className="fw-semibold">Img CR-API:</span>
          <RadioGroup name={`imgcr-${rows.length}`} value={imgCrFilter} options={[{ val: 'all', label: 'All' }, { val: 'yes', label: 'Yes' }, { val: 'no', label: 'No' }]} onChange={v => { setImgCrFilter(v); setFixableOnly(false); }} />
        </span>
        <span className="d-flex align-items-center gap-2">
          <span className="fw-semibold">Img Scan:</span>
          <RadioGroup name={`imgscan-${rows.length}`} value={imgScanFilter} options={[{ val: 'all', label: 'All' }, { val: 'yes', label: 'Yes' }, { val: 'no', label: 'No' }]} onChange={v => { setImgScanFilter(v); setFixableOnly(false); }} />
        </span>
        {fixableCount > 0 && (
          <button type="button" className={`btn btn-sm ${fixableOnly ? 'btn-secondary' : 'btn-outline-secondary'}`} onClick={() => setFixableOnly(f => !f)}>
            ⚡ Fixable only ({fixableCount})
          </button>
        )}
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={reset}>Reset</button>
      </div>

      {/* Stats bar */}
      <div className="small text-muted mb-2">
        {inBoth} matched · {crOnly} CR-API only · {scanOnly} Scan only
        {fixableCount > 0 && <span className="ms-2 text-info fw-semibold">⚡ {fixableCount} fixable</span>}
      </div>

      {/* Table */}
      {visible.length === 0 ? (
        <p className="text-muted small mb-0">No rows match the current filters.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table table-sm table-bordered mb-0 small">
            <thead className="table-light">
              <tr>
                <th>Code CR-API</th>
                <th>Code Scan</th>
                <th>CR-API Name</th>
                <th>Scan Name</th>
                <th className="text-center">Match</th>
                <th className="text-center">Img CR-API</th>
                <th className="text-center">Img Scan</th>
                <th className="text-center">Img Both</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.key} className={rowClass(r)}>
                  <td className="font-monospace">{r.crCode || '—'}</td>
                  <td className="font-monospace">{r.scanCode || '—'}</td>
                  <td>{r.crName || '—'}</td>
                  <td>{r.scanName || '—'}</td>
                  <td className="text-center">{matchBadge(r)}</td>
                  <td className="text-center">{yn(r.imgCr)}</td>
                  <td className="text-center">{yn(r.imgScan)}</td>
                  <td className="text-center">{yn(r.imgBoth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tomorrow(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

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

  const [expandedOcc, setExpandedOcc] = React.useState<Map<number, Set<string>>>(new Map());

  // Expanded hotel card IDs — all open by default when entries load
  const [expandedHotels, setExpandedHotels] = React.useState<Set<number>>(new Set());

  // ── Filters & grouping ────────────────────────────────────────────────────
  const [selectedHotelIds, setSelectedHotelIds] = React.useState<number[]>([]);
  const [groupBy, setGroupBy] = React.useState<GroupBy>('none');
  const [attentionFilter, setAttentionFilter] = React.useState<AttentionFilter>('all');
  const [qualityFilter, setQualityFilter] = React.useState<QualityFilter>('all');

  const allHotels = React.useMemo(
    () => entries.map(e => ({ id: e.hotel.id, name: e.hotel.name, code: e.hotel.code, brand: e.hotel.brand ?? undefined })),
    [entries],
  );

  const filtered = React.useMemo(() => {
    return entries.filter(e => {
      if (selectedHotelIds.length > 0 && !selectedHotelIds.includes(e.hotel.id)) return false;
      if (attentionFilter === 'attention' && !hasAttention(e)) return false;
      if (attentionFilter === 'fixable' && !isFixable(e)) return false;
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
      const key = groupBy === 'brand' ? (e.hotel.brand ?? '(No Brand)') : (e.hotel.region ?? '(No Region)');
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, es]) => ({ key, label: key, entries: es.sort((a, b) => a.hotel.name.localeCompare(b.hotel.name)) }));
  }, [filtered, groupBy]);

  // All visible hotel IDs (for expand/collapse all)
  const allVisibleIds = React.useMemo(
    () => filtered.map(e => e.hotel.id),
    [filtered],
  );
  const anyExpanded = allVisibleIds.some(id => expandedHotels.has(id));

  function toggleExpandAll() {
    if (anyExpanded) {
      setExpandedHotels(new Set());
    } else {
      setExpandedHotels(new Set(allVisibleIds));
    }
  }

  function toggleHotel(hotelId: number) {
    setExpandedHotels(prev => {
      const next = new Set(prev);
      if (next.has(hotelId)) {
        next.delete(hotelId);
      } else {
        next.add(hotelId);
      }
      return next;
    });
  }

  // ── Load scan history ──────────────────────────────────────────────────────

  const loadScans = React.useCallback(async () => {
    try {
      const list = await fetchJSON('/api/playwright-scan/scans', { cache: 'no-store' });
      if (Array.isArray(list)) setScans(list);
    } catch {
      // non-fatal
    }
  }, []);

  React.useEffect(() => {
    loadScans();
  }, [loadScans]);

  // Auto-select most recent done scan on first load
  React.useEffect(() => {
    if (scans.length > 0 && selectedScanId === null) {
      const done = scans.find(s => s.status === 'done');
      if (done) setSelectedScanId(done.id);
    }
  }, [scans, selectedScanId]);

  // ── Load hotel data ────────────────────────────────────────────────────────

  const loadEntries = React.useCallback(
    async (scanId: number | null) => {
      setLoadingEntries(true);
      setEntriesError(null);
      try {
        const url =
          scanId !== null
            ? `/api/rooms-cr-api?playwrightScanId=${scanId}`
            : '/api/rooms-cr-api';
        const data = await fetchJSON(url, { cache: 'no-store' });
        const loaded: HotelEntry[] = Array.isArray(data) ? data : [];
        setEntries(loaded);
        setExpandedHotels(new Set(loaded.map((e: HotelEntry) => e.hotel.id)));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to load data';
        setEntriesError(msg);
      } finally {
        setLoadingEntries(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    setSelectedHotelIds([]);
    loadEntries(selectedScanId);
  }, [selectedScanId, loadEntries]);

  // ── Polling for active scan ────────────────────────────────────────────────

  React.useEffect(() => {
    if (activeScanId === null) return;

    const interval = setInterval(async () => {
      try {
        const data: PlaywrightScan = await fetchJSON(
          `/api/playwright-scan?scanId=${activeScanId}`,
          { cache: 'no-store' },
        );
        setActiveScanStatus(data);
        if (data.status === 'done' || data.status === 'cancelled') {
          clearInterval(interval);
          setActiveScanId(null);
          // Reload scan list and results
          await loadScans();
          setSelectedScanId(data.id);
        }
      } catch {
        // ignore transient errors
      }
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
        body: JSON.stringify({ checkIn, takeScreenshot }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `Error ${res.status}`);
      }
      const { scanId, total } = json as { scanId: number; total: number };
      setActiveScanId(scanId);
      setActiveScanStatus({
        id: scanId,
        check_in: checkIn,
        take_screenshot: takeScreenshot,
        status: 'running',
        total,
        processed: 0,
        errors: 0,
        created_at: new Date().toISOString(),
        finished_at: null,
      });
      await loadScans();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to start scan';
      setStartError(msg);
    } finally {
      setStarting(false);
    }
  }

  // ── Toggle occupancy accordion ─────────────────────────────────────────────

  function toggleOcc(hotelId: number, label: string) {
    setExpandedOcc(prev => {
      const next = new Map(prev);
      const set = new Set(next.get(hotelId) ?? []);
      if (set.has(label)) {
        set.delete(label);
      } else {
        set.add(label);
      }
      next.set(hotelId, set);
      return next;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const isScanning = activeScanId !== null;
  const scanPct =
    activeScanStatus && activeScanStatus.total > 0
      ? Math.round(
          ((activeScanStatus.processed + activeScanStatus.errors) / activeScanStatus.total) * 100,
        )
      : 0;

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>
        <h4 className="mb-3">Rooms / CR-API</h4>

        {/* ── Scan trigger card ── */}
        <div className="card mb-4">
          <div className="card-header fw-semibold">Amello Rooms Scan</div>
          <div className="card-body">
            {startError && (
              <div className="alert alert-danger alert-dismissible py-2" role="alert">
                {startError}
                <button type="button" className="btn-close" onClick={() => setStartError(null)} />
              </div>
            )}

            {!isScanning && (
              <div className="row g-3 align-items-end">
                <div className="col-sm-auto">
                  <label className="form-label fw-semibold">Check-In Date</label>
                  <input
                    type="date"
                    className="form-control form-control-sm"
                    value={checkIn}
                    onChange={e => setCheckIn(e.target.value)}
                  />
                </div>
                <div className="col-sm-auto d-flex align-items-end pb-1">
                  <div className="form-check">
                    <input
                      type="checkbox"
                      id="takeScreenshot"
                      className="form-check-input"
                      checked={takeScreenshot}
                      onChange={e => setTakeScreenshot(e.target.checked)}
                    />
                    <label className="form-check-label" htmlFor="takeScreenshot">
                      Take Screenshots
                    </label>
                  </div>
                </div>
                <div className="col-sm-auto">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={startScan}
                    disabled={starting || !checkIn}
                  >
                    {starting ? (
                      <>
                        <span className="spinner-border spinner-border-sm me-1" />
                        Starting…
                      </>
                    ) : (
                      'Start Scan'
                    )}
                  </button>
                </div>
              </div>
            )}

            {isScanning && activeScanStatus && (
              <div>
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <span className="small fw-semibold">
                    Scanning… {activeScanStatus.processed + activeScanStatus.errors} /{' '}
                    {activeScanStatus.total} processed
                    {activeScanStatus.errors > 0 && (
                      <span className="text-danger ms-2">({activeScanStatus.errors} errors)</span>
                    )}
                  </span>
                  <span className="small text-muted">{scanPct}%</span>
                </div>
                <div className="progress" style={{ height: 8 }}>
                  <div
                    className="progress-bar progress-bar-striped progress-bar-animated"
                    role="progressbar"
                    style={{ width: `${scanPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Filters & grouping toolbar ── */}
        <div className="card mb-3">
          <div className="card-body py-2">
            {/* Row 1: Scan selection + expand/collapse all */}
            <div className="d-flex align-items-end gap-3 pb-2 mb-2 border-bottom">
              <div>
                <label htmlFor="scan-select" className="form-label form-label-sm mb-1 fw-semibold">Scan</label>
                <select id="scan-select" className="form-select form-select-sm" style={{ minWidth: 260 }} value={selectedScanId ?? ''} onChange={e => setSelectedScanId(Number(e.target.value) || null)}>
                  <option value="">— no scan selected —</option>
                  {scans.map(s => (
                    <option key={s.id} value={s.id}>
                      #{s.id} — {s.check_in} — {s.status} ({s.processed}/{s.total})
                    </option>
                  ))}
                </select>
              </div>
              <span className="small text-muted align-self-end pb-1">{entries.length} hotel{entries.length !== 1 ? 's' : ''}{filtered.length !== entries.length ? ` (${filtered.length} shown)` : ''}</span>
              {filtered.length > 0 && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary ms-auto align-self-end"
                  onClick={toggleExpandAll}
                >
                  {anyExpanded ? 'Collapse All' : 'Expand All'}
                </button>
              )}
            </div>
            {/* Row 2: Filters */}
            <div className="d-flex flex-wrap align-items-end gap-3">
              <div>
                <div className="form-label form-label-sm mb-1 fw-semibold" id="lbl-hotels">Hotels</div>
                <HotelCombobox hotels={allHotels} selectedIds={selectedHotelIds} onChange={setSelectedHotelIds} size="sm" />
              </div>
              <div>
                <div className="form-label form-label-sm mb-1 fw-semibold" id="lbl-groupby">Group by</div>
                <div className="btn-group btn-group-sm" role="group" aria-labelledby="lbl-groupby">
                  {(['none', 'brand', 'region'] as GroupBy[]).map(g => (
                    <button key={g} type="button" className={`btn btn-outline-secondary${groupBy === g ? ' active' : ''}`} onClick={() => setGroupBy(g)}>
                      {g === 'none' ? 'Per Hotel' : g.charAt(0).toUpperCase() + g.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="form-label form-label-sm mb-1 fw-semibold" id="lbl-filter">Filter</div>
                <div className="btn-group btn-group-sm" role="group" aria-labelledby="lbl-filter">
                  <button type="button" className={`btn btn-outline-secondary${attentionFilter === 'all' ? ' active' : ''}`} onClick={() => setAttentionFilter('all')}>All</button>
                  <button type="button" className={`btn btn-outline-secondary${attentionFilter === 'attention' ? ' active' : ''}`} onClick={() => setAttentionFilter(attentionFilter === 'attention' ? 'all' : 'attention')}>⚠ Attention needed</button>
                  <button type="button" className={`btn btn-outline-secondary${attentionFilter === 'fixable' ? ' active' : ''}`} onClick={() => setAttentionFilter(attentionFilter === 'fixable' ? 'all' : 'fixable')}>⚡ Fix potential</button>
                </div>
              </div>
              <div>
                <div className="d-flex align-items-center gap-1 mb-1">
                  <span className="form-label form-label-sm fw-semibold mb-0" id="lbl-quality">Mapping quality</span>
                  <QualityHelpButton />
                </div>
                <div className="btn-group btn-group-sm flex-wrap" role="group" aria-labelledby="lbl-quality">
                  <button type="button" className={`btn btn-outline-secondary${qualityFilter === 'all' ? ' active' : ''}`} onClick={() => setQualityFilter('all')}>All</button>
                  {(['perfect', 'verygood', 'good', 'mediocre', 'poor', 'horrible'] as Quality[]).map(q => (
                    <button
                      key={q}
                      type="button"
                      className={`btn btn-outline-secondary${qualityFilter === q ? ' active' : ''}`}
                      onClick={() => setQualityFilter(qualityFilter === q ? 'all' : q)}
                    >
                      {QUALITY_LABELS[q]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Loading ── */}
        {loadingEntries && (
          <div className="text-center py-5">
            <div className="spinner-border text-secondary" role="status">
              <span className="visually-hidden">Loading…</span>
            </div>
          </div>
        )}

        {entriesError && (
          <div className="alert alert-danger" role="alert">
            {entriesError}
          </div>
        )}

        {/* ── Hotel cards ── */}
        {!loadingEntries && groups.map(group => (
          <div key={group.key}>
            {groupBy !== 'none' && (
              <div className="d-flex align-items-center gap-2 mb-2 mt-3">
                <h6 className="mb-0 fw-bold">{group.label}</h6>
                <span className="badge bg-secondary fw-normal">{group.entries.length}</span>
              </div>
            )}
            {group.entries.map(entry => {
              const isOpen = expandedHotels.has(entry.hotel.id);
              const mappingRows = entry.playwrightResults !== null
                ? buildMapping(entry.crRooms, entry.playwrightResults)
                : null;
              const matched  = mappingRows ? mappingRows.filter(r => r.inBoth).length : 0;
              const crOnly   = mappingRows ? mappingRows.filter(r => r.inCr && !r.inScan).length : 0;
              const scanOnly = mappingRows ? mappingRows.filter(r => !r.inCr && r.inScan).length : 0;

              return (
                <div key={entry.hotel.id} className="card mb-2">
                  {/* Header — clickable toggle */}
                  <div
                    className="card-header fw-semibold d-flex align-items-center gap-2 flex-wrap"
                    style={{ cursor: 'pointer' }}
                    onClick={() => toggleHotel(entry.hotel.id)}
                    role="button"
                    aria-expanded={isOpen}
                  >
                    {/* Chevron — Bootstrap accordion-style SVG */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"
                      style={{ flexShrink: 0, transition: 'transform 0.15s ease', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                      <path fillRule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
                    </svg>

                    {/* Hotel meta */}
                    <span>
                      {entry.hotel.name}
                      <span className="ms-2 text-muted fw-normal small">{entry.hotel.code}</span>
                      {entry.hotel.brand && <span className="ms-2 badge bg-light text-dark fw-normal">{entry.hotel.brand}</span>}
                      {entry.hotel.region && <span className="ms-1 text-muted fw-normal small">{entry.hotel.region}{entry.hotel.country ? `, ${entry.hotel.country}` : ''}</span>}
                    </span>

                    {/* Mapping summary (collapsed state) */}
                    {mappingRows !== null && (
                      <span className="text-muted fw-normal small ms-2">
                        {matched} matched · {crOnly} CR-API only · {scanOnly} scan only
                      </span>
                    )}

                    {/* Badges */}
                    <span className="ms-auto d-flex gap-2 align-items-center">
                      {hasAttention(entry) && <span className="badge bg-warning text-dark">⚠ attention</span>}
                      {isFixable(entry) && <span className="badge bg-info text-dark">⚡ fixable</span>}
                      {(() => { const q = computeQuality(entry); return q ? <span className={`badge bg-${QUALITY_COLORS[q]}${q === 'mediocre' || q === 'poor' ? ' text-dark' : ''} fw-normal`}>{QUALITY_LABELS[q]}</span> : null; })()}
                      <span className="badge bg-primary fw-normal">CR-API: {entry.crRooms.length}</span>
                    </span>
                  </div>

                  {/* Card body — only render when expanded */}
                  {isOpen && (
                    <div className="card-body">
                      {/* 1. Rooms panel — CR-API + Amello combined, collapsible */}
                      <RoomsPanel
                        hotelId={entry.hotel.id}
                        hotelName={entry.hotel.name}
                        crRooms={entry.crRooms}
                        playwrightResults={entry.playwrightResults}
                        expandedOcc={expandedOcc}
                        toggleOcc={toggleOcc}
                      />

                      {/* 2. Code Mapping table */}
                      {(entry.crRooms.length > 0 || entry.playwrightResults !== null) && mappingRows !== null && (
                        <>
                          <hr className="my-2" style={{ opacity: 0.3 }} />
                          <MappingTable rows={mappingRows} />
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {!loadingEntries && filtered.length === 0 && !entriesError && (
          <p className="text-muted">{entries.length === 0 ? 'No data loaded yet.' : 'No hotels match the current filters.'}</p>
        )}
      </div>
    </main>
  );
}
