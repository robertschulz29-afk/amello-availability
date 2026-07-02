'use client';

import * as React from 'react';
import { OCCUPANCY_CONFIGS } from '@/lib/playwright-scan-helpers';
import { CrRoom, PlaywrightOccResult } from './types';

// ── Types ─────────────────────────────────────────────────────────────────────

export type MappingRow = {
  key:      string;
  crCode:   string;
  scanCode:    string;
  crName:      string;
  scanName:    string;
  inCr:        boolean;
  inScan:      boolean;
  inBoth:      boolean;
  imgCr:       boolean;
  imgScan:     boolean;
  imgBoth:     boolean;
  occPresence: Record<string, boolean>;
};

// ── Build mapping logic ───────────────────────────────────────────────────────

export function buildMapping(crRooms: CrRoom[], playwrightResults: Record<string, PlaywrightOccResult> | null): MappingRow[] {
  const scanRoomMap = new Map<string, { roomCode: string; roomName: string; hasImage: boolean }>();
  const occPresenceMap = new Map<string, Record<string, boolean>>();

  for (const [folder, result] of Object.entries(playwrightResults ?? {})) {
    for (const r of result.rooms ?? []) {
      const key = r.roomCode ? `${r.roomCode}||${r.roomName}` : r.roomName;
      const hasImage = !r.imageMissing;
      const existing = scanRoomMap.get(key);
      if (!existing || hasImage) {
        scanRoomMap.set(key, { roomCode: r.roomCode, roomName: r.roomName, hasImage: hasImage || (existing?.hasImage ?? false) });
      }
      if (!occPresenceMap.has(key)) occPresenceMap.set(key, {});
      occPresenceMap.get(key)![folder] = true;
    }
  }

  const crByCode = new Map<string, CrRoom>();
  const crByName = new Map<string, CrRoom>();
  for (const cr of crRooms) {
    if (cr.room_code) crByCode.set(cr.room_code, cr);
    crByName.set(cr.name.trim().toLowerCase(), cr);
  }

  const rows: MappingRow[] = [];
  const crMatchedKeys = new Set<string>();

  for (const [key, data] of scanRoomMap) {
    let matchedCr = data.roomCode ? crByCode.get(data.roomCode) : undefined;
    if (!matchedCr) matchedCr = crByName.get(data.roomName.trim().toLowerCase());
    if (matchedCr) crMatchedKeys.add(matchedCr.room_code || matchedCr.name);

    rows.push({
      key,
      crCode:      matchedCr?.room_code ?? '',
      scanCode:    data.roomCode,
      crName:      matchedCr?.name ?? '',
      scanName:    data.roomName,
      inCr:        !!matchedCr,
      inScan:      true,
      inBoth:      !!matchedCr,
      imgCr:       matchedCr ? !!matchedCr.image_url : false,
      imgScan:     data.hasImage,
      imgBoth:     (matchedCr ? !!matchedCr.image_url : false) && data.hasImage,
      occPresence: occPresenceMap.get(key) ?? {},
    });
  }

  for (const cr of crRooms) {
    const crKey = cr.room_code || cr.name;
    if (!crMatchedKeys.has(crKey)) {
      rows.push({
        key:         `cr::${crKey}`,
        crCode:      cr.room_code ?? '',
        scanCode:    '',
        crName:      cr.name,
        scanName:    '',
        inCr:        true,
        inScan:      false,
        inBoth:      false,
        imgCr:       !!cr.image_url,
        imgScan:     false,
        imgBoth:     false,
        occPresence: {},
      });
    }
  }

  return rows.sort((a, b) => {
    const aKey = a.crCode || a.scanCode || a.crName || a.scanName;
    const bKey = b.crCode || b.scanCode || b.crName || b.scanName;
    return aKey.localeCompare(bKey);
  });
}

// ── isFixable helper (uses buildMapping) ──────────────────────────────────────

export function isFixable(crRooms: CrRoom[], playwrightResults: Record<string, PlaywrightOccResult> | null): boolean {
  if (!playwrightResults) return false;
  const rows = buildMapping(crRooms, playwrightResults);
  const hasScanNoImage   = rows.some(r => r.inScan && !r.imgScan);
  const hasCrOnlyWithImg = rows.some(r => r.inCr && !r.inScan && r.imgCr);
  return hasScanNoImage && hasCrOnlyWithImg;
}

// ── Filter helpers ────────────────────────────────────────────────────────────

type MatchFilter  = 'all' | 'match' | 'mismatch';
type ImgFilter    = 'all' | 'yes' | 'no';

function RadioGroup<T extends string>({ name, value, options, onChange }: {
  name: string; value: T; options: { val: T; label: string }[]; onChange: (v: T) => void;
}) {
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

// ── Mapping table component ───────────────────────────────────────────────────

export function MappingTable({ rows, fixPotentialActive = false, onFixPotentialToggle }: {
  rows: MappingRow[];
  fixPotentialActive?: boolean;
  onFixPotentialToggle?: () => void;
}) {
  const [matchFilter,  setMatchFilter]  = React.useState<MatchFilter>('all');
  const [imgCrFilter,  setImgCrFilter]  = React.useState<ImgFilter>('all');
  const [imgScanFilter, setImgScanFilter] = React.useState<ImgFilter>('all');

  const showFixable = fixPotentialActive;

  const fixableApplicable = rows.some(r => r.inScan && !r.imgScan) && rows.some(r => r.inCr && !r.inScan && r.imgCr);
  const fixableCount = fixableApplicable
    ? rows.filter(r => (r.inCr && !r.inScan && r.imgCr) || (r.inScan && !r.imgScan)).length
    : 0;

  const visible = rows.filter(r => {
    if (showFixable) {
      return (r.inCr && !r.inScan && r.imgCr) || (r.inScan && !r.imgScan);
    }
    if (matchFilter === 'match'    && !r.inBoth) return false;
    if (matchFilter === 'mismatch' &&  r.inBoth) return false;
    if (imgCrFilter   === 'yes' && r.inCr  && !r.imgCr)  return false;
    if (imgCrFilter   === 'no'  && r.inCr  &&  r.imgCr)  return false;
    if (imgScanFilter === 'yes' && r.inScan && !r.imgScan) return false;
    if (imgScanFilter === 'no'  && r.inScan &&  r.imgScan) return false;
    return true;
  });

  const inBoth    = rows.filter(r => r.inBoth).length;
  const crOnly    = rows.filter(r => r.inCr  && !r.inScan).length;
  const scanOnly  = rows.filter(r => r.inScan && !r.inCr).length;

  const yn = (v: boolean) => v
    ? <span className="text-success fw-semibold">Yes</span>
    : <span className="text-danger">No</span>;

  function matchBadge(r: MappingRow) {
    if (r.inBoth) return <span className="badge bg-success-subtle text-success-emphasis">Both</span>;
    if (r.inCr && !r.inScan) return <span className="badge bg-warning-subtle text-warning-emphasis">CR-API only</span>;
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
        Mapping — CR-API ↔ Scan
        <span className="ms-2 text-muted fw-normal">({rows.length} codes)</span>
      </div>

      <div className="d-flex flex-wrap align-items-center gap-3 mb-2 small">
        <span className="d-flex align-items-center gap-2">
          <span className="fw-semibold">Match:</span>
          <RadioGroup name={`match-${rows.length}`} value={matchFilter} options={[{ val: 'all', label: 'All' }, { val: 'match', label: 'Match only' }, { val: 'mismatch', label: 'Missing match' }]} onChange={v => setMatchFilter(v)} />
        </span>
        <span className="d-flex align-items-center gap-2">
          <span className="fw-semibold">Img CR-API:</span>
          <RadioGroup name={`imgcr-${rows.length}`} value={imgCrFilter} options={[{ val: 'all', label: 'All' }, { val: 'yes', label: 'Yes' }, { val: 'no', label: 'No' }]} onChange={v => setImgCrFilter(v)} />
        </span>
        <span className="d-flex align-items-center gap-2">
          <span className="fw-semibold">Img Scan:</span>
          <RadioGroup name={`imgscan-${rows.length}`} value={imgScanFilter} options={[{ val: 'all', label: 'All' }, { val: 'yes', label: 'Yes' }, { val: 'no', label: 'No' }]} onChange={v => setImgScanFilter(v)} />
        </span>
        {fixableCount > 0 && onFixPotentialToggle && (
          <button type="button" className={`btn btn-sm ${fixPotentialActive ? 'btn-secondary' : 'btn-outline-secondary'}`} onClick={onFixPotentialToggle}>
            ⚡ Fix potential ({fixableCount})
          </button>
        )}
      </div>

      <div className="small text-muted mb-2">
        {inBoth} matched · {crOnly} CR-API only · {scanOnly} Scan only
        {fixableCount > 0 && <span className="ms-2 text-info fw-semibold">⚡ {fixableCount} fixable</span>}
      </div>

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
                <th className="text-center" style={{ borderLeft: '2px solid #6c757d', borderTop: '2px solid #6c757d' }}>Img CR-API</th>
                <th className="text-center" style={{ borderTop: '2px solid #6c757d' }}>Img Scan</th>
                <th className="text-center" style={{ borderRight: '2px solid #6c757d', borderTop: '2px solid #6c757d' }}>Img Both</th>
                {OCCUPANCY_CONFIGS.map(cfg => (
                  <th key={cfg.folder} className="text-center">{cfg.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r, idx) => {
                const isLast = idx === visible.length - 1;
                const boldB = isLast ? '2px solid #6c757d' : undefined;
                return (
                  <tr key={r.key} className={rowClass(r)}>
                    <td className="font-monospace">{r.crCode || '—'}</td>
                    <td className="font-monospace">{r.scanCode || '—'}</td>
                    <td>{r.crName || '—'}</td>
                    <td>{r.scanName || '—'}</td>
                    <td className="text-center">{matchBadge(r)}</td>
                    <td className="text-center" style={{ borderLeft: '2px solid #6c757d', borderBottom: boldB }}>{yn(r.imgCr)}</td>
                    <td className="text-center" style={{ borderBottom: boldB }}>{yn(r.imgScan)}</td>
                    <td className="text-center" style={{ borderRight: '2px solid #6c757d', borderBottom: boldB }}>{yn(r.imgBoth)}</td>
                    {OCCUPANCY_CONFIGS.map(cfg => (
                      <td key={cfg.folder} className="text-center">{yn(!!r.occPresence[cfg.folder])}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
