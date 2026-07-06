'use client';
// app/room-mappings/page.tsx

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';

// ── Types ─────────────────────────────────────────────────────────────────────

type ScanSource = { id: number; name: string; enabled: boolean };

type Member = {
  memberId: number;
  groupId: number;
  source: string;
  roomNameId: number;
  roomName: string;
  memberStatus: 'manual' | 'ai';
  confidence: number | null;
};

type Group = {
  groupId: number;
  hotelId: number;
  source: 'manual' | 'ai';
  confidence: number | null;
  members: Member[];
};

type RoomNameRef = { id: number; source: string; roomName: string };

type HotelData = {
  id: number;
  name: string;
  code: string;
  groups: Group[];
  unmapped: RoomNameRef[];
};

type Suggestion = {
  sourceA: string;
  sourceB: string;
  roomNameIdA: number;
  roomNameA: string;
  roomNameIdB: number;
  roomNameB: string;
  confidence: number;
  reasoning: string;
};

// hotelId -> suggestion[]
type AllSuggestions = Map<number, Suggestion[]>;

const SOURCE_ORDER = ['amello', 'booking', 'booking_member', 'check24'];

function sourceDisplayLabel(source: string) {
  if (source === 'amello') return 'TUI-Hotels';
  if (source === 'booking') return 'Booking';
  if (source === 'booking_member') return 'Booking Member';
  if (source === 'check24') return 'Check24';
  return source;
}

function sortSources(sources: string[]): string[] {
  return [...sources].sort((a, b) => {
    const ai = SOURCE_ORDER.indexOf(a);
    const bi = SOURCE_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
}

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence == null) return null;
  const pct = Math.round(confidence * 100);
  const cls = pct >= 90 ? 'text-bg-success' : pct >= 75 ? 'text-bg-warning' : 'text-bg-danger';
  return <span className={`badge ${cls} ms-1`} style={{ fontSize: '0.6rem' }}>{pct}%</span>;
}

// ── Inline unlink confirm popover ───────────────────────────────────────────────

function UnlinkPopover({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div
      className="card shadow-sm p-2"
      style={{ position: 'absolute', zIndex: 20, minWidth: 180 }}
      onClick={e => e.stopPropagation()}
    >
      <div className="small mb-2">Remove this mapping?</div>
      <div className="d-flex gap-1">
        <button className="btn btn-sm btn-danger" onClick={onConfirm}>Remove</button>
        <button className="btn btn-sm btn-outline-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── One cell within a group row for a given source column ───────────────────────

function GroupCell({
  hotel,
  group,
  source,
  hasSourceData,
  onChanged,
}: {
  hotel: HotelData;
  group: Group;
  source: string;
  hasSourceData: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [selected, setSelected] = React.useState('');
  const [confirmingUnlink, setConfirmingUnlink] = React.useState(false);
  const [changeError, setChangeError] = React.useState<string | null>(null);

  const member = group.members.find(m => m.source === source);

  const unmappedForSource = hotel.unmapped.filter(r => r.source === source);

  const addMember = async (memberStatus: 'manual' | 'ai' = 'manual') => {
    if (!selected) return;
    setBusy(true);
    try {
      await fetchJSON(`/api/room-mappings/${group.groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, roomNameId: Number(selected), memberStatus }),
      });
      setAdding(false);
      setSelected('');
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async () => {
    if (!member) return;
    setBusy(true);
    try {
      await fetchJSON(`/api/room-mappings/${group.groupId}/members?memberId=${member.memberId}`, { method: 'DELETE' });
      setConfirmingUnlink(false);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const confirmAi = async () => {
    if (!member) return;
    setBusy(true);
    try {
      await fetchJSON(`/api/room-mappings/${group.groupId}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: member.memberId }),
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  // Replace an AI-pending member with a different room. If this member is the
  // last one in its group, removing it deletes the group (per the API's
  // documented last-member behavior), so we must create a fresh group instead
  // of re-attaching to the now-gone groupId. Any failure surfaces inline
  // rather than being silently swallowed, since the old mapping is already
  // gone by the time the replacement attempt happens.
  const changeAiMember = async () => {
    if (!member || !selected) return;
    setBusy(true);
    setChangeError(null);
    const wasLastMember = group.members.length === 1;
    try {
      await fetchJSON(`/api/room-mappings/${group.groupId}/members?memberId=${member.memberId}`, { method: 'DELETE' });

      if (wasLastMember) {
        await fetchJSON('/api/room-mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hotelId: hotel.id, source, roomNameId: Number(selected),
            groupSource: 'ai', memberStatus: 'ai', confidence: member.confidence,
          }),
        });
      } else {
        await fetchJSON(`/api/room-mappings/${group.groupId}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source, roomNameId: Number(selected), memberStatus: 'ai', confidence: member.confidence }),
        });
      }

      setAdding(false);
      setSelected('');
      await onChanged();
    } catch (e: any) {
      setChangeError(e.message || 'Failed to change mapping — the original mapping was removed; please re-select.');
    } finally {
      setBusy(false);
    }
  };

  if (!hasSourceData) {
    return <td className="align-top py-2 text-muted small fst-italic">No {sourceDisplayLabel(source)} scan data yet</td>;
  }

  if (member && member.memberStatus === 'ai') {
    return (
      <td className="align-top py-2" style={{ background: 'rgba(13,110,253,0.06)' }}>
        {!adding ? (
          <div>
            <div className="d-flex align-items-center gap-1 flex-wrap">
              <span className="small">{member.roomName}</span>
              <span className="badge text-bg-info" style={{ fontSize: '0.6rem' }}>AI</span>
              <ConfidenceBadge confidence={member.confidence} />
            </div>
            <div className="d-flex gap-1 mt-1">
              <button className="btn btn-sm btn-success" disabled={busy} onClick={confirmAi}>
                {busy ? <span className="spinner-border spinner-border-sm" /> : '✓ Confirm'}
              </button>
              <button className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={() => { setSelected(String(member.roomNameId)); setAdding(true); }}>Change</button>
              <button className="btn btn-sm btn-outline-danger" disabled={busy} onClick={removeMember}>Reject</button>
            </div>
          </div>
        ) : (
          <div>
            <div className="d-flex gap-1 align-items-center">
              <select className="form-select form-select-sm" style={{ maxWidth: 220 }} value={selected} onChange={e => setSelected(e.target.value)} disabled={busy}>
                <option value="">— select room —</option>
                {unmappedForSource.map(r => <option key={r.id} value={r.id}>{r.roomName}</option>)}
              </select>
              <button className="btn btn-sm btn-success" disabled={busy || !selected} onClick={changeAiMember}>
                {busy ? <span className="spinner-border spinner-border-sm" /> : '✓'}
              </button>
              <button className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={() => { setAdding(false); setChangeError(null); }}>✕</button>
            </div>
            {changeError && <div className="text-danger small mt-1">{changeError}</div>}
          </div>
        )}
      </td>
    );
  }

  if (member) {
    return (
      <td className="align-top py-2 position-relative">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <span className="small">{member.roomName}</span>
          <button
            className="btn btn-outline-danger ms-auto"
            style={{ padding: '1px 6px', fontSize: '0.7rem' }}
            onClick={() => setConfirmingUnlink(true)}
            title="Unlink"
          >
            ✕
          </button>
        </div>
        {confirmingUnlink && (
          <UnlinkPopover onConfirm={removeMember} onCancel={() => setConfirmingUnlink(false)} />
        )}
      </td>
    );
  }

  // No member for this source yet
  return (
    <td className="align-top py-2">
      {!adding ? (
        <button className="btn btn-sm btn-outline-secondary" onClick={() => setAdding(true)} disabled={!unmappedForSource.length}>
          — [+ add]
        </button>
      ) : (
        <div className="d-flex gap-1 align-items-center">
          <select className="form-select form-select-sm" style={{ maxWidth: 220 }} value={selected} onChange={e => setSelected(e.target.value)} disabled={busy}>
            <option value="">— select room —</option>
            {unmappedForSource.map(r => <option key={r.id} value={r.id}>{r.roomName}</option>)}
          </select>
          <button className="btn btn-sm btn-success" disabled={busy || !selected} onClick={() => addMember('manual')}>
            {busy ? <span className="spinner-border spinner-border-sm" /> : '✓'}
          </button>
          <button className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={() => setAdding(false)}>✕</button>
        </div>
      )}
    </td>
  );
}

// ── Per-hotel section ─────────────────────────────────────────────────────────

function HotelSection({
  hotel,
  columnSources,
  suggestions,
  onMappingChange,
}: {
  hotel: HotelData;
  columnSources: string[];
  suggestions: Suggestion[];
  onMappingChange: () => Promise<void>;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [msg, setMsg] = React.useState<{ text: string; ok: boolean } | null>(null);
  const [busyAll, setBusyAll] = React.useState(false);

  React.useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  // Sources with any data at all for this hotel (grouped members + unmapped rooms).
  const sourcesWithData = React.useMemo(() => {
    const s = new Set<string>();
    for (const g of hotel.groups) for (const m of g.members) s.add(m.source);
    for (const r of hotel.unmapped) s.add(r.source);
    return s;
  }, [hotel]);

  const availableSourceCount = sourcesWithData.size;

  const aiPendingMembers = React.useMemo(
    () => hotel.groups.flatMap(g => g.members.filter(m => m.memberStatus === 'ai')),
    [hotel.groups]
  );

  const fullyMappedCount = hotel.groups.filter(g => g.members.length >= availableSourceCount && availableSourceCount > 0).length;
  const partialCount = hotel.groups.filter(g => g.members.length < availableSourceCount).length;

  const wrap = async (fn: () => Promise<void>) => {
    try {
      await fn();
      setMsg({ text: 'Saved.', ok: true });
    } catch (e: any) {
      setMsg({ text: e.message || 'Failed', ok: false });
    }
  };

  const acceptAllAi = async () => {
    if (!aiPendingMembers.length) return;
    setBusyAll(true);
    for (const m of aiPendingMembers) {
      try {
        await fetchJSON(`/api/room-mappings/${m.groupId}/members`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memberId: m.memberId }),
        });
      } catch { /* skip individual failures */ }
    }
    setMsg({ text: `Accepted ${aiPendingMembers.length} AI mapping(s).`, ok: true });
    await onMappingChange();
    setBusyAll(false);
  };

  const startMapping = async (room: RoomNameRef) => {
    await wrap(async () => {
      await fetchJSON('/api/room-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotelId: hotel.id, source: room.source, roomNameId: room.id }),
      });
      await onMappingChange();
    });
  };

  return (
    <div className="card mb-3">
      <div
        className="card-header d-flex align-items-center gap-2 flex-wrap"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setCollapsed(c => !c)}
      >
        <span className="fw-semibold">{hotel.name}</span>
        <span className="text-muted small">({hotel.code})</span>
        <div className="ms-auto d-flex align-items-center gap-2 flex-wrap">
          {hotel.unmapped.length > 0 && <span className="badge text-bg-warning">{hotel.unmapped.length} unmapped</span>}
          {partialCount > 0 && <span className="badge text-bg-secondary">{partialCount} partial</span>}
          {aiPendingMembers.length > 0 && (
            <>
              <span className="badge text-bg-info">{aiPendingMembers.length} AI pending</span>
              <button
                className="btn btn-sm btn-outline-success"
                style={{ fontSize: '0.7rem', padding: '1px 8px' }}
                disabled={busyAll}
                onClick={e => { e.stopPropagation(); acceptAllAi(); }}
              >
                {busyAll ? <span className="spinner-border spinner-border-sm" /> : '✓ Accept all'}
              </button>
            </>
          )}
          {hotel.unmapped.length === 0 && partialCount === 0 && fullyMappedCount > 0 && (
            <span className="badge text-bg-success">fully mapped</span>
          )}
          {hotel.groups.length === 0 && hotel.unmapped.length === 0 && (
            <span className="badge text-bg-secondary border">no scan data</span>
          )}
          <span className="text-muted small">{collapsed ? '▼' : '▲'}</span>
        </div>
      </div>

      {!collapsed && (
        <div className="card-body p-0">
          {msg && (
            <div className={`alert py-2 small mb-0 rounded-0 ${msg.ok ? 'alert-success' : 'alert-danger'}`}>
              {msg.text}
            </div>
          )}

          {columnSources.length === 0 ? (
            <p className="text-muted small m-3">No scan sources configured.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm mb-0 align-middle">
                <thead className="table-light">
                  <tr>
                    <th style={{ width: 40 }}></th>
                    {columnSources.map(src => (
                      <th key={src}>{sourceDisplayLabel(src)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hotel.groups.length === 0 && (
                    <tr><td colSpan={columnSources.length + 1} className="text-muted small py-2">No mapped groups yet — start from an unmapped room below.</td></tr>
                  )}
                  {hotel.groups.map(group => {
                    const full = group.members.length >= availableSourceCount && availableSourceCount > 0;
                    return (
                      <tr key={group.groupId} style={{ borderLeft: `4px solid ${full ? '#198754' : '#fd7e14'}` }}>
                        <td className="align-top py-2">
                          {full
                            ? <span className="badge text-bg-success" title="Fully mapped">✓ {group.members.length}/{availableSourceCount}</span>
                            : <span className="badge text-bg-warning" title="Partial">◐ {group.members.length}/{availableSourceCount}</span>}
                        </td>
                        {columnSources.map(src => (
                          <GroupCell
                            key={src}
                            hotel={hotel}
                            group={group}
                            source={src}
                            hasSourceData={sourcesWithData.has(src)}
                            onChanged={onMappingChange}
                          />
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Unmapped rooms per column ── */}
          <div className="p-3 border-top">
            <div className="fw-semibold small mb-2 text-muted">Unmapped rooms</div>
            <div className="row">
              {columnSources.filter(src => sourcesWithData.has(src)).map(src => {
                const rooms = hotel.unmapped.filter(r => r.source === src);
                return (
                  <div key={src} className="col-md-3 mb-2">
                    <div className="small fw-semibold mb-1">{sourceDisplayLabel(src)} ({rooms.length})</div>
                    {rooms.length === 0 ? (
                      <div className="text-muted small fst-italic">All mapped</div>
                    ) : (
                      <ul className="list-unstyled small mb-0">
                        {rooms.map(r => (
                          <li key={r.id} className="d-flex align-items-center gap-2 mb-1">
                            <span className="text-truncate" style={{ maxWidth: 160 }} title={r.roomName}>{r.roomName}</span>
                            <button className="btn btn-sm btn-outline-warning ms-auto" style={{ fontSize: '0.7rem', padding: '1px 6px' }} onClick={() => startMapping(r)}>
                              + start mapping
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {suggestions.length > 0 && (
            <div className="p-3 border-top bg-light">
              <div className="fw-semibold small mb-2">AI suggestions pending review ({suggestions.length})</div>
              <ul className="list-unstyled small mb-0">
                {suggestions.map((s, i) => (
                  <li key={i} className="mb-1">
                    <span className="fst-italic text-muted">{sourceDisplayLabel(s.sourceA)}:</span> {s.roomNameA}
                    {' ↔ '}
                    <span className="fst-italic text-muted">{sourceDisplayLabel(s.sourceB)}:</span> {s.roomNameB}
                    <ConfidenceBadge confidence={s.confidence} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type MappingFilter = 'all' | 'mapped' | 'partial' | 'unmapped' | 'pending';

export default function Page() {
  const [hotels, setHotels] = React.useState<HotelData[]>([]);
  const [scanSources, setScanSources] = React.useState<ScanSource[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');

  const [suggesting, setSuggesting] = React.useState(false);
  const [suggestProgress, setSuggestProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [allSuggestions, setAllSuggestions] = React.useState<AllSuggestions>(new Map());
  const [aiMsg, setAiMsg] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [data, sources] = await Promise.all([
        fetchJSON('/api/room-mappings', { cache: 'no-store' }),
        fetchJSON('/api/scan-sources', { cache: 'no-store' }),
      ]);
      setHotels(data.hotels ?? []);
      setScanSources(sources ?? []);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  // Column source list: enabled sources in fixed order, plus any source with
  // historical data even if since disabled (kept visible per design decision).
  const columnSources = React.useMemo(() => {
    const enabled = scanSources.filter(s => s.enabled).map(s => s.name);
    const historical = new Set<string>();
    for (const h of hotels) {
      for (const g of h.groups) for (const m of g.members) historical.add(m.source);
      for (const r of h.unmapped) historical.add(r.source);
    }
    const all = new Set([...enabled, ...historical]);
    return sortSources(Array.from(all));
  }, [scanSources, hotels]);

  const runAiAll = async () => {
    const eligible = hotels.filter(h => h.unmapped.length > 0);
    if (!eligible.length) return;

    setSuggesting(true);
    setAiMsg(null);
    setAllSuggestions(new Map());
    setSuggestProgress({ done: 0, total: eligible.length });

    let totalApplied = 0;

    for (let i = 0; i < eligible.length; i++) {
      const hotel = eligible[i];
      try {
        const result = await fetchJSON('/api/room-mappings/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hotelId: hotel.id }),
        });

        // Only confident suggestions (>= threshold) are auto-applied as AI-pending
        // members. Low-confidence "skipped" suggestions are surfaced for manual
        // review only — never written to the DB automatically.
        const confident: Suggestion[] = result.suggestions ?? [];
        const lowConfidence: Suggestion[] = result.skipped ?? [];

        if (lowConfidence.length) {
          setAllSuggestions(prev => {
            const next = new Map(prev);
            next.set(hotel.id, [...(next.get(hotel.id) ?? []), ...lowConfidence]);
            return next;
          });
        }

        for (const s of confident) {
          try {
            // Re-fetch this hotel's current grouping state to decide attach-vs-create,
            // since earlier suggestions applied in this loop may have changed it.
            const fresh: HotelData = await fetchJSON(`/api/room-mappings?hotelId=${hotel.id}`, { cache: 'no-store' });
            const groupWithA = fresh.groups.find(g => g.members.some(m => m.roomNameId === s.roomNameIdA));
            const groupWithB = fresh.groups.find(g => g.members.some(m => m.roomNameId === s.roomNameIdB));

            if (groupWithA && !groupWithA.members.some(m => m.source === s.sourceB)) {
              await fetchJSON(`/api/room-mappings/${groupWithA.groupId}/members`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source: s.sourceB, roomNameId: s.roomNameIdB, memberStatus: 'ai', confidence: s.confidence }),
              });
              totalApplied++;
            } else if (groupWithB && !groupWithB.members.some(m => m.source === s.sourceA)) {
              await fetchJSON(`/api/room-mappings/${groupWithB.groupId}/members`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source: s.sourceA, roomNameId: s.roomNameIdA, memberStatus: 'ai', confidence: s.confidence }),
              });
              totalApplied++;
            } else if (!groupWithA && !groupWithB) {
              const created = await fetchJSON('/api/room-mappings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  hotelId: hotel.id, source: s.sourceA, roomNameId: s.roomNameIdA,
                  groupSource: 'ai', memberStatus: 'ai', confidence: s.confidence,
                }),
              });
              await fetchJSON(`/api/room-mappings/${created.groupId}/members`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source: s.sourceB, roomNameId: s.roomNameIdB, memberStatus: 'ai', confidence: s.confidence }),
              });
              totalApplied++;
            }
            // else: both already grouped with those sources filled — skip, nothing to do.
          } catch {
            // skip individual save failures silently
          }
        }
      } catch {
        // skip failed hotels silently
      }
      setSuggestProgress({ done: i + 1, total: eligible.length });
    }

    await load();

    setSuggesting(false);
    setSuggestProgress(null);
    setAiMsg(totalApplied > 0
      ? `AI applied ${totalApplied} suggestion${totalApplied !== 1 ? 's' : ''} for review.`
      : 'No new suggestions found.');
  };

  const [mappingFilter, setMappingFilter] = React.useState<MappingFilter>('all');
  const [missingSourceFilter, setMissingSourceFilter] = React.useState<string>('any');

  const hotelMatchesFilter = React.useCallback((h: HotelData) => {
    const sourcesWithData = new Set<string>();
    for (const g of h.groups) for (const m of g.members) sourcesWithData.add(m.source);
    for (const r of h.unmapped) sourcesWithData.add(r.source);
    const availableCount = sourcesWithData.size;

    const partialGroups = h.groups.filter(g => g.members.length < availableCount);
    const fullGroups = h.groups.filter(g => g.members.length >= availableCount && availableCount > 0);
    const aiPending = h.groups.some(g => g.members.some(m => m.memberStatus === 'ai'));

    if (mappingFilter === 'mapped') {
      return h.unmapped.length === 0 && partialGroups.length === 0 && fullGroups.length > 0;
    }
    if (mappingFilter === 'partial') {
      if (partialGroups.length === 0) return false;
      if (missingSourceFilter === 'any') return true;
      return partialGroups.some(g => !g.members.some(m => m.source === missingSourceFilter));
    }
    if (mappingFilter === 'unmapped') {
      return h.unmapped.length > 0;
    }
    if (mappingFilter === 'pending') {
      return aiPending;
    }
    return true;
  }, [mappingFilter, missingSourceFilter]);

  const filtered = React.useMemo(() => {
    let list = hotels;
    if (search.trim()) {
      const term = search.toLowerCase();
      list = list.filter(h => h.name.toLowerCase().includes(term) || h.code.toLowerCase().includes(term));
    }
    list = list.filter(hotelMatchesFilter);
    return list;
  }, [hotels, search, hotelMatchesFilter]);

  const totalUnmapped = React.useMemo(() => hotels.reduce((acc, h) => acc + h.unmapped.length, 0), [hotels]);

  return (
    <main>
      <div style={{ maxWidth: '95%', margin: '0 auto' }}>

        {/* ── Global header ── */}
        <div className="d-flex align-items-center gap-3 mb-3 flex-wrap">
          {!loading && totalUnmapped > 0 && (
            <span className="badge text-bg-warning fs-6">{totalUnmapped} unmapped total</span>
          )}
          <a href="/rate-comparison" className="btn btn-outline-secondary btn-sm ms-auto">
            ← Back to Rate Comparison
          </a>
        </div>

        {/* ── Global AI bar ── */}
        <div className="card mb-4">
          <div className="card-body d-flex align-items-center gap-3 flex-wrap py-2">
            <div>
              <span className="fw-semibold">AI Auto-Mapping</span>
              <span className="text-muted small ms-2">Suggests matches between unmapped rooms across all source pairs, for all hotels</span>
            </div>
            <div className="ms-auto d-flex align-items-center gap-2">
              {suggestProgress && (
                <span className="text-muted small">{suggestProgress.done} / {suggestProgress.total} hotels…</span>
              )}
              {aiMsg && !suggesting && <span className="text-muted small fst-italic">{aiMsg}</span>}
              <button className="btn btn-dark" onClick={runAiAll} disabled={suggesting || loading}>
                {suggesting
                  ? <><span className="spinner-border spinner-border-sm me-1"></span>Running AI…</>
                  : '✨ Run AI for All Hotels'}
              </button>
            </div>
          </div>
          {suggesting && suggestProgress && (
            <div className="progress" style={{ height: 3, borderRadius: 0 }}>
              <div className="progress-bar" style={{ width: `${(suggestProgress.done / suggestProgress.total) * 100}%`, transition: 'width 0.3s' }}></div>
            </div>
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
          <div className="btn-group">
            {(['all', 'mapped', 'partial', 'unmapped', 'pending'] as const).map(f => (
              <button
                key={f}
                type="button"
                className={`btn btn-sm ${mappingFilter === f ? 'btn-secondary' : 'btn-outline-secondary'}`}
                onClick={() => setMappingFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'mapped' ? 'Fully mapped' : f === 'partial' ? 'Partial' : f === 'unmapped' ? 'Unmapped' : 'AI pending'}
              </button>
            ))}
          </div>
          <select
            className="form-select form-select-sm"
            style={{ maxWidth: 220 }}
            value={missingSourceFilter}
            disabled={mappingFilter !== 'partial'}
            onChange={e => setMissingSourceFilter(e.target.value)}
          >
            <option value="any">Missing source: any</option>
            {columnSources.map(src => (
              <option key={src} value={src}>Missing source: {sourceDisplayLabel(src)}</option>
            ))}
          </select>
        </div>

        {loading && (
          <div className="text-center my-5">
            <div className="spinner-border text-primary" role="status"></div>
            <div className="mt-2 text-muted">Loading all room data…</div>
          </div>
        )}

        {!loading && filtered.map(hotel => (
          <HotelSection
            key={hotel.id}
            hotel={hotel}
            columnSources={columnSources}
            suggestions={allSuggestions.get(hotel.id) ?? []}
            onMappingChange={load}
          />
        ))}

        {!loading && filtered.length === 0 && (
          <p className="text-muted">No hotels match the filter.</p>
        )}
      </div>
    </main>
  );
}
