'use client';
// app/imagery-mappings/page.tsx

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';

// ── Types ─────────────────────────────────────────────────────────────────────

type ImageryMapping = {
  id: number;
  hotel_id: number;
  imagery_room_name: string;
  scan_room_name: string;
  source: 'manual' | 'ai';
  confidence: number | null;
  updated_at: string;
};

type HotelData = {
  id: number;
  name: string;
  code: string;
  mappings: ImageryMapping[];
  imageryRooms: { room_name: string; image_url: string }[];
  scanRooms: string[];
};

type Suggestion = {
  scan_room: string;
  imagery_room: string;
  confidence: number;
  reasoning: string;
};

// hotelId → (scanRoom → Suggestion)
type AllSuggestions = Map<number, Map<string, Suggestion>>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence == null) return null;
  const pct = Math.round(confidence * 100);
  const cls = pct >= 90 ? 'text-bg-success' : pct >= 75 ? 'text-bg-warning' : 'text-bg-danger';
  return <span className={`badge ${cls} ms-1`} style={{ fontSize: '0.65rem' }}>{pct}%</span>;
}

// ── Right-column cell per scan room ──────────────────────────────────────────

type RoomRowProps = {
  scanRoom: string;
  mapping: ImageryMapping | undefined;
  suggestion: Suggestion | undefined;
  imageryRooms: { room_name: string; image_url: string }[];
  onSave: (scanRoom: string, imageryRoomName: string, source: 'manual' | 'ai', confidence?: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onSuggestionUsed: (scanRoom: string) => void;
};

function RoomRow({ scanRoom, mapping, suggestion, imageryRooms, onSave, onDelete, onSuggestionUsed }: RoomRowProps) {
  const [editing, setEditing] = React.useState(false);
  const [selected, setSelected] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const openEdit = () => {
    setSelected(mapping?.imagery_room_name ?? suggestion?.imagery_room ?? '');
    setEditing(true);
  };

  const save = async () => {
    if (!selected) return;
    setBusy(true);
    await onSave(scanRoom, selected, 'manual');
    setEditing(false);
    setBusy(false);
  };

  const acceptAi = async () => {
    if (!mapping) return;
    setBusy(true);
    await onSave(scanRoom, mapping.imagery_room_name, 'manual');
    setBusy(false);
  };

  const confirmSuggestion = async () => {
    if (!suggestion) return;
    setBusy(true);
    await onSave(scanRoom, suggestion.imagery_room, 'ai', suggestion.confidence);
    onSuggestionUsed(scanRoom);
    setBusy(false);
  };

  // Look up thumbnail for a given imagery room name
  const getThumbnail = (imageryRoomName: string) => {
    return imageryRooms.find(r => r.room_name === imageryRoomName)?.image_url ?? null;
  };

  const editDropdown = (
    <div className="d-flex gap-1 align-items-center mt-1">
      <select
        className="form-select form-select-sm"
        value={selected}
        onChange={e => setSelected(e.target.value)}
        disabled={busy}
        style={{ maxWidth: 280 }}
      >
        <option value="">— select imagery room —</option>
        {imageryRooms.map(r => (
          <option key={r.room_name} value={r.room_name}>
            {r.room_name}{r.image_url ? ' 🖼' : ''}
          </option>
        ))}
      </select>
      <button className="btn btn-sm btn-success" onClick={save} disabled={busy || !selected}>
        {busy ? <span className="spinner-border spinner-border-sm"></span> : '✓'}
      </button>
      <button className="btn btn-sm btn-outline-secondary" onClick={() => setEditing(false)} disabled={busy}>✕</button>
    </div>
  );

  // Mapped manually
  if (mapping && mapping.source === 'manual') {
    const thumb = getThumbnail(mapping.imagery_room_name);
    return (
      <td className="align-top py-2">
        {!editing ? (
          <div className="d-flex align-items-center gap-2 flex-wrap">
            {thumb && (
              <img src={thumb} alt={mapping.imagery_room_name} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
            )}
            <span className="small">{mapping.imagery_room_name}</span>
            <span className="badge bg-secondary" style={{ fontSize: '0.6rem' }}>manual</span>
            <button className="btn btn-outline-secondary ms-auto" style={{ padding: '1px 6px', fontSize: '0.7rem' }} onClick={openEdit}>
              <i className="fa fa-pencil"></i>
            </button>
            <button className="btn btn-outline-danger" style={{ padding: '1px 6px', fontSize: '0.7rem' }} onClick={() => onDelete(mapping.id)}>
              <i className="fa fa-times"></i>
            </button>
          </div>
        ) : editDropdown}
      </td>
    );
  }

  // Mapped by AI — needs acceptance
  if (mapping && mapping.source === 'ai') {
    const thumb = getThumbnail(mapping.imagery_room_name);
    return (
      <td className="align-top py-2">
        {!editing ? (
          <div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              {thumb && (
                <img src={thumb} alt={mapping.imagery_room_name} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
              )}
              <span className="small">{mapping.imagery_room_name}</span>
              <span className="badge text-bg-info" style={{ fontSize: '0.6rem' }}>AI</span>
              <ConfidenceBadge confidence={mapping.confidence} />
            </div>
            <div className="d-flex gap-1 mt-1">
              <button className="btn btn-sm btn-success" onClick={acceptAi} disabled={busy}>
                {busy ? <span className="spinner-border spinner-border-sm"></span> : '✓ Accept'}
              </button>
              <button className="btn btn-sm btn-outline-secondary" onClick={openEdit}>Change</button>
              <button className="btn btn-sm btn-outline-danger" onClick={() => onDelete(mapping.id)}>
                <i className="fa fa-times"></i>
              </button>
            </div>
          </div>
        ) : editDropdown}
      </td>
    );
  }

  // Unmapped — with or without AI suggestion
  return (
    <td className="align-top py-2">
      {!editing ? (
        suggestion ? (
          <div>
            <div className="d-flex align-items-center gap-1 flex-wrap">
              {getThumbnail(suggestion.imagery_room) && (
                <img
                  src={getThumbnail(suggestion.imagery_room)!}
                  alt={suggestion.imagery_room}
                  style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                />
              )}
              <span className="small text-muted fst-italic">{suggestion.imagery_room}</span>
              <span className="badge text-bg-info" style={{ fontSize: '0.6rem' }}>AI suggestion</span>
              <ConfidenceBadge confidence={suggestion.confidence} />
            </div>
            <div className="text-muted fst-italic mb-1" style={{ fontSize: '0.7rem' }}>{suggestion.reasoning}</div>
            <div className="d-flex gap-1">
              <button className="btn btn-sm btn-success" onClick={confirmSuggestion} disabled={busy}>
                {busy ? <span className="spinner-border spinner-border-sm"></span> : '✓ Confirm'}
              </button>
              <button className="btn btn-sm btn-outline-secondary" onClick={openEdit}>Change</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-sm btn-outline-warning" onClick={openEdit}>+ Map image</button>
        )
      ) : editDropdown}
    </td>
  );
}

// ── Per-hotel section ─────────────────────────────────────────────────────────

function HotelSection({
  hotel,
  suggestions,
  onMappingChange,
  onSuggestionUsed,
}: {
  hotel: HotelData;
  suggestions: Map<string, Suggestion>;
  onMappingChange: () => void;
  onSuggestionUsed: (hotelId: number, scanRoom: string) => void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [msg, setMsg] = React.useState<{ text: string; ok: boolean } | null>(null);
  const [busy_, setBusy_] = React.useState(false);

  React.useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  const mappingByScanRoom = React.useMemo(() => {
    const map = new Map<string, ImageryMapping>();
    for (const m of hotel.mappings) map.set(m.scan_room_name, m);
    return map;
  }, [hotel.mappings]);

  const unmappedCount = hotel.scanRooms.filter(r => !mappingByScanRoom.has(r)).length;
  const aiPendingCount = hotel.mappings.filter(m => m.source === 'ai').length;
  const pendingSuggestionsCount = hotel.scanRooms.filter(r => !mappingByScanRoom.has(r) && suggestions.has(r)).length;

  const acceptAll = async () => {
    const pending = hotel.mappings.filter(m => m.source === 'ai');
    if (!pending.length) return;
    setBusy_(true);
    for (const m of pending) {
      try {
        await fetchJSON('/api/imagery-mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hotelId: hotel.id,
            imageryRoomName: m.imagery_room_name,
            scanRoomName: m.scan_room_name,
            source: 'manual',
            confidence: m.confidence,
          }),
        });
      } catch { /* skip */ }
    }
    setMsg({ text: `Accepted ${pending.length} AI mapping(s).`, ok: true });
    onMappingChange();
    setBusy_(false);
  };

  const handleSave = async (scanRoom: string, imageryRoomName: string, source: 'manual' | 'ai', confidence?: number) => {
    try {
      await fetchJSON('/api/imagery-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotelId: hotel.id,
          imageryRoomName,
          scanRoomName: scanRoom,
          source,
          confidence: confidence ?? null,
        }),
      });
      setMsg({ text: 'Saved.', ok: true });
      onMappingChange();
    } catch (e: any) {
      setMsg({ text: e.message || 'Failed to save', ok: false });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Remove this mapping?')) return;
    try {
      await fetchJSON(`/api/imagery-mappings?id=${id}`, { method: 'DELETE' });
      setMsg({ text: 'Mapping removed.', ok: true });
      onMappingChange();
    } catch (e: any) {
      setMsg({ text: e.message || 'Failed to delete', ok: false });
    }
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
          {unmappedCount > 0 && <span className="badge text-bg-warning">{unmappedCount} unmapped</span>}
          {pendingSuggestionsCount > 0 && <span className="badge text-bg-info">{pendingSuggestionsCount} AI suggestions</span>}
          {aiPendingCount > 0 && (
            <>
              <span className="badge text-bg-info">{aiPendingCount} AI pending</span>
              <button
                className="btn btn-sm btn-outline-success"
                style={{ fontSize: '0.7rem', padding: '1px 8px' }}
                disabled={busy_}
                onClick={e => { e.stopPropagation(); acceptAll(); }}
              >
                {busy_ ? <span className="spinner-border spinner-border-sm" /> : '✓ Accept all'}
              </button>
            </>
          )}
          {unmappedCount === 0 && aiPendingCount === 0 && hotel.scanRooms.length > 0 && (
            <span className="badge text-bg-success">fully mapped</span>
          )}
          {hotel.scanRooms.length === 0 && <span className="badge text-bg-secondary border">no scan data</span>}
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

          {hotel.scanRooms.length === 0 ? (
            <p className="text-muted small m-3">No scan rooms yet. Run a scan first.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm table-hover mb-0 align-middle">
                <thead className="table-light">
                  <tr>
                    <th style={{ width: '45%' }}>Scan Room</th>
                    <th>TUI Imagery Room</th>
                  </tr>
                </thead>
                <tbody>
                  {hotel.scanRooms.map(scanRoom => (
                    <tr key={scanRoom}>
                      <td className="fw-semibold small align-top py-2">{scanRoom}</td>
                      <RoomRow
                        scanRoom={scanRoom}
                        mapping={mappingByScanRoom.get(scanRoom)}
                        suggestion={suggestions.get(scanRoom)}
                        imageryRooms={hotel.imageryRooms}
                        onSave={handleSave}
                        onDelete={handleDelete}
                        onSuggestionUsed={(room) => onSuggestionUsed(hotel.id, room)}
                      />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Page() {
  const [hotels, setHotels] = React.useState<HotelData[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');

  type FilterBool = 'all' | 'true' | 'false';
  const [filterActive,   setFilterActive]   = React.useState<FilterBool>('true');
  const [filterBookable, setFilterBookable] = React.useState<FilterBool>('true');

  // Global AI state
  const [suggesting, setSuggesting] = React.useState(false);
  const [suggestProgress, setSuggestProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [allSuggestions, setAllSuggestions] = React.useState<AllSuggestions>(new Map());
  const [aiMsg, setAiMsg] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterActive   !== 'all') params.set('active',   filterActive);
      if (filterBookable !== 'all') params.set('bookable', filterBookable);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const data = await fetchJSON(`/api/imagery-mappings${qs}`, { cache: 'no-store' });
      setHotels(data.hotels ?? []);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [filterActive, filterBookable]);

  React.useEffect(() => { load(); }, [load]);

  // Run AI for all hotels sequentially so we can show progress
  const runAiAll = async () => {
    const eligible = hotels.filter(h => h.scanRooms.length > 0 && h.imageryRooms.length > 0);
    if (!eligible.length) return;

    setSuggesting(true);
    setAiMsg(null);
    setAllSuggestions(new Map());
    setSuggestProgress({ done: 0, total: eligible.length });

    let totalSuggestions = 0;

    for (let i = 0; i < eligible.length; i++) {
      const hotel = eligible[i];
      try {
        const result = await fetchJSON('/api/imagery-mappings/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hotelId: hotel.id }),
        });

        // Save ALL suggestions (both high and low confidence) to DB immediately
        const allFromAi = [...(result.suggestions ?? []), ...(result.skipped ?? [])];
        for (const s of allFromAi) {
          try {
            await fetchJSON('/api/imagery-mappings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                hotelId: hotel.id,
                imageryRoomName: s.imagery_room,
                scanRoomName: s.scan_room,
                source: 'ai',
                confidence: s.confidence,
              }),
            });
            totalSuggestions++;
          } catch {
            // skip individual save failures silently
          }
        }
      } catch {
        // skip failed hotels silently
      }
      setSuggestProgress({ done: i + 1, total: eligible.length });
    }

    // Reload all mapping data from DB so newly saved AI mappings appear
    await load();

    setSuggesting(false);
    setSuggestProgress(null);
    setAllSuggestions(new Map());
    setAiMsg(totalSuggestions > 0
      ? `AI saved ${totalSuggestions} mapping${totalSuggestions !== 1 ? 's' : ''} to review.`
      : 'No new suggestions found.');
  };

  const handleSuggestionUsed = (hotelId: number, scanRoom: string) => {
    setAllSuggestions(prev => {
      const next = new Map(prev);
      const hotelMap = next.get(hotelId);
      if (hotelMap) {
        const updatedHotelMap = new Map(hotelMap);
        updatedHotelMap.delete(scanRoom);
        if (updatedHotelMap.size === 0) next.delete(hotelId);
        else next.set(hotelId, updatedHotelMap);
      }
      return next;
    });
  };

  type MappingFilter = 'all' | 'unmapped' | 'pending';
  const [mappingFilter, setMappingFilter] = React.useState<MappingFilter>('all');

  const filtered = React.useMemo(() => {
    let list = hotels;
    if (search.trim()) {
      const term = search.toLowerCase();
      list = list.filter(h => h.name.toLowerCase().includes(term) || h.code.toLowerCase().includes(term));
    }
    if (mappingFilter === 'unmapped') {
      const mapped = (h: HotelData) => new Set(h.mappings.map(m => m.scan_room_name));
      list = list.filter(h => h.scanRooms.some(r => !mapped(h).has(r)));
    } else if (mappingFilter === 'pending') {
      list = list.filter(h => h.mappings.some(m => m.source === 'ai'));
    }
    return list;
  }, [hotels, search, mappingFilter]);

  const totalUnmapped = React.useMemo(() =>
    hotels.reduce((acc, h) => {
      const mapped = new Set(h.mappings.map(m => m.scan_room_name));
      return acc + h.scanRooms.filter(r => !mapped.has(r)).length;
    }, 0), [hotels]
  );

  const totalPendingSuggestions = React.useMemo(() =>
    Array.from(allSuggestions.values()).reduce((acc, m) => acc + m.size, 0),
    [allSuggestions]
  );

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>

        {/* ── Global header ── */}
        <div className="d-flex align-items-center gap-3 mb-3 flex-wrap">
          <h1 className="h4 mb-0">Imagery Mappings</h1>
          {!loading && totalUnmapped > 0 && (
            <span className="badge text-bg-warning fs-6">{totalUnmapped} unmapped total</span>
          )}
        </div>

        {/* ── Global AI bar ── */}
        <div className="card mb-4">
          <div className="card-body d-flex align-items-center gap-3 flex-wrap py-2">
            <div>
              <span className="fw-semibold">AI Auto-Mapping</span>
              <span className="text-muted small ms-2">Suggests TUI imagery matches for all unmapped scan rooms across all hotels</span>
            </div>
            <div className="ms-auto d-flex align-items-center gap-2">
              {suggestProgress && (
                <span className="text-muted small">
                  {suggestProgress.done} / {suggestProgress.total} hotels…
                </span>
              )}
              {totalPendingSuggestions > 0 && !suggesting && (
                <span className="badge text-bg-info">{totalPendingSuggestions} suggestions pending</span>
              )}
              {aiMsg && !suggesting && (
                <span className="text-muted small fst-italic">{aiMsg}</span>
              )}
              <button
                className="btn btn-dark"
                onClick={runAiAll}
                disabled={suggesting || loading}
              >
                {suggesting
                  ? <><span className="spinner-border spinner-border-sm me-1"></span>Running AI…</>
                  : '✨ Run AI for All Hotels'}
              </button>
            </div>
          </div>
          {suggesting && suggestProgress && (
            <div className="progress" style={{ height: 3, borderRadius: 0 }}>
              <div
                className="progress-bar"
                style={{ width: `${(suggestProgress.done / suggestProgress.total) * 100}%`, transition: 'width 0.3s' }}
              ></div>
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
            {(['all', 'unmapped', 'pending'] as const).map(f => (
              <button
                key={f}
                type="button"
                className={`btn btn-sm ${mappingFilter === f ? 'btn-secondary' : 'btn-outline-secondary'}`}
                onClick={() => setMappingFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'unmapped' ? 'Unmapped' : 'Pending Approval'}
              </button>
            ))}
          </div>
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
        </div>

        {loading && (
          <div className="text-center my-5">
            <div className="spinner-border text-primary" role="status"></div>
            <div className="mt-2 text-muted">Loading imagery mappings…</div>
          </div>
        )}

        {!loading && filtered.map(hotel => (
          <HotelSection
            key={hotel.id}
            hotel={hotel}
            suggestions={allSuggestions.get(hotel.id) ?? new Map()}
            onMappingChange={load}
            onSuggestionUsed={handleSuggestionUsed}
          />
        ))}

        {!loading && filtered.length === 0 && (
          <p className="text-muted">No hotels match the filter.</p>
        )}
      </div>
    </main>
  );
}
