'use client';

import * as React from 'react';

export type ScanDetails = {
  scanId: number;
  scannedAt: string;
  baseCheckIn: string | null;
  days: number | null;
  stayNights: number | null;
  timezone: string | null;
  hotelTotal: number | null;
  hotelBookableActive: number | null;
};

type ScanOption = { id: number; scanned_at: string; status: string };

function fmtDateTime(dt: string) { try { return new Date(dt).toLocaleString(); } catch { return dt; } }
function fmtDate(dt: string)     { try { return new Date(String(dt).slice(0, 10) + 'T00:00:00').toLocaleDateString(); } catch { return dt; } }

export function ScanInfoCard({
  scans,
  selectedScanId,
  onScanChange,
  scanDetails,
  className = 'mb-3',
}: {
  scans: ScanOption[];
  selectedScanId: number | null;
  onScanChange: (id: number | null) => void;
  scanDetails: ScanDetails | null;
  className?: string;
}) {
  return (
    <div className={`card ${className}`}>
      <div className="card-header">Scan Parameters</div>
      <div className="card-body small">
        <select
          className="form-select form-select-sm mb-2"
          value={selectedScanId ?? ''}
          onChange={e => onScanChange(e.target.value ? Number(e.target.value) : null)}
        >
          {scans.length === 0
            ? <option value="">No scans</option>
            : scans.map(s => (
              <option key={s.id} value={s.id}>
                #{s.id} • {fmtDateTime(s.scanned_at)} • {s.status}
              </option>
            ))}
        </select>
        {scanDetails && (
          <div className="d-flex flex-column gap-1">
            <div><strong>Scan ID:</strong> {scanDetails.scanId}</div>
            <div><strong>Scanned at:</strong> {fmtDateTime(scanDetails.scannedAt)}</div>
            <div><strong>Timezone:</strong> {scanDetails.timezone ?? '—'}</div>
            <div><strong>Base check-in:</strong> {scanDetails.baseCheckIn ? fmtDate(scanDetails.baseCheckIn) : '—'}</div>
            <div><strong>Days scanned:</strong> {scanDetails.days ?? '—'}</div>
            <div><strong>Stay nights:</strong> {scanDetails.stayNights ?? '—'}</div>
            {scanDetails.hotelTotal != null && (<>
              <div><strong>Hotels (total):</strong> {scanDetails.hotelTotal}</div>
              <div><strong>Hotels (bookable &amp; active):</strong> {scanDetails.hotelBookableActive ?? '—'}</div>
            </>)}
          </div>
        )}
      </div>
    </div>
  );
}
