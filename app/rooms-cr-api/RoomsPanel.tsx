'use client';

import * as React from 'react';
import { OCCUPANCY_CONFIGS } from '@/lib/playwright-scan-helpers';
import { CrRoom, PlaywrightOccResult } from './types';

// ── Simple CR room table ──────────────────────────────────────────────────────

function CrRoomTable({ rows }: { rows: CrRoom[] }) {
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

// ── Rooms panel (CR-API + Amello scan results, collapsible) ──────────────────

export function RoomsPanel({
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

  const withImage    = crRooms.filter(r =>  r.image_url);
  const withoutImage = crRooms.filter(r => !r.image_url);

  return (
    <div>
      <button
        type="button"
        className="btn btn-link btn-sm text-start p-0 fw-semibold text-decoration-none small d-flex align-items-center gap-2"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"
          style={{ flexShrink: 0, transition: 'transform 0.15s ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          <path fillRule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/>
        </svg>
        Rooms
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
                    <CrRoomTable rows={withImage} />
                  </div>
                )}
                {withoutImage.length > 0 && (
                  <div>
                    <div className="small text-danger mb-1">Without image ({withoutImage.length})</div>
                    <CrRoomTable rows={withoutImage} />
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
