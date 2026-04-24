'use client';

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';

// ─── Cookie settings ──────────────────────────────────────────────────────────

const COOKIE_FIELDS: Array<{ name: string; label: string; hint: string }> = [
  { name: 'bkng',             label: 'bkng',             hint: 'Main session token' },
  { name: 'bkng_sso_auth',    label: 'bkng_sso_auth',    hint: 'SSO authentication token' },
  { name: 'bkng_sso_session', label: 'bkng_sso_session', hint: 'SSO session (base64 JSON)' },
  { name: 'bkng_sso_ses',     label: 'bkng_sso_ses',     hint: 'SSO session short form' },
  { name: 'pcm_consent',      label: 'pcm_consent',      hint: 'GDPR consent cookie' },
  { name: 'aws-waf-token',    label: 'aws-waf-token',    hint: 'AWS WAF bot-protection token' },
];

type CookieMap = Record<string, string>;

type TestResult = {
  loggedIn: boolean;
  indicators?: { hasGenius: boolean; hasAvatar: boolean; signInTextFound: boolean };
  error?: string;
};

function parseCookieString(raw: string): CookieMap {
  const map: CookieMap = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) map[key] = val;
  }
  return map;
}

function buildCookieString(fields: CookieMap): string {
  return COOKIE_FIELDS
    .filter(f => fields[f.name]?.trim())
    .map(f => `${f.name}=${fields[f.name].trim()}`)
    .join('; ');
}

// ─── Global type collectors ───────────────────────────────────────────────────

type CollectorType = { global_type: string };
type Collector = {
  id: number;
  name: string;
  description: string | null;
  type_category_id: number | null;
  global_type_category: string | null;
  types: CollectorType[];
};
type Category = { id: number; global_type_category: string };
type UnassignedType = {
  global_type_label: React.ReactNode; global_type: string 
};

function toTitleCase(s: string): string {
  return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function CollectorsSection() {
  const [collectors, setCollectors] = React.useState<Collector[]>([]);
  const [unassigned, setUnassigned] = React.useState<UnassignedType[]>([]);
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // collector list selection
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [searchTerm, setSearchTerm] = React.useState('');

  // new collector form
  const [newName, setNewName] = React.useState('');
  const [newDesc, setNewDesc] = React.useState('');
  const [newCatId, setNewCatId] = React.useState<number | ''>('');
  const [creating, setCreating] = React.useState(false);

  // edit collector category inline
  const [editCatId, setEditCatId] = React.useState<number | ''>('');
  const [savingCat, setSavingCat] = React.useState(false);

  // new category form
  const [newCatName, setNewCatName] = React.useState('');
  const [creatingCat, setCreatingCat] = React.useState(false);

  // global type assignments
  const [saving, setSaving] = React.useState(false);
  const [savedMsg, setSavedMsg] = React.useState(false);
  const [pending, setPending] = React.useState<Map<string, number | null>>(new Map());

  const reload = React.useCallback(() => {
    setLoading(true);
    fetchJSON('/api/global_types/collectors')
      .then(d => {
        setCollectors(d.collectors ?? []);
        setUnassigned(d.unassigned ?? []);
        setCategories(d.categories ?? []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { reload(); }, [reload]);

  const selected = collectors.find(c => c.id === selectedId) ?? null;

  // sync editCatId when selection changes
  React.useEffect(() => {
    setEditCatId(selected?.type_category_id ?? '');
  }, [selectedId, selected?.type_category_id]);

  const effectiveTypes = (c: Collector): string[] => {
    const base = c.types.map(t => t.global_type).filter(gt => pending.get(gt) !== null);
    const added = [...pending.entries()]
      .filter(([, cid]) => cid === c.id)
      .map(([gt]) => gt)
      .filter(gt => !base.includes(gt));
    return [...base, ...added];
  };

  const effectiveUnassigned = unassigned
    .filter(u => !pending.has(u.global_type) || pending.get(u.global_type) === null)
    .concat(
      collectors.flatMap(c => c.types
        .filter(t => pending.get(t.global_type) === null)
        .map(t => ({ global_type: t.global_type, global_type_label: t.global_type }))
      )
    );

  const filteredUnassigned = effectiveUnassigned.filter(u => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    const label = typeof u.global_type_label === 'string' ? u.global_type_label.toLowerCase() : '';
    return u.global_type.toLowerCase().includes(term) || label.includes(term);
  });

  const assign = (global_type: string, collector_id: number | null) =>
    setPending(prev => new Map(prev).set(global_type, collector_id));

  const saveAssignments = async () => {
    setSaving(true);
    setSavedMsg(false);
    try {
      const assignments = [...pending.entries()].map(([global_type, collector_id]) => ({ global_type, collector_id }));
      await fetch('/api/global_types/assignments', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments }),
      });
      setPending(new Map());
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 3000);
      reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const createCollector = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/global_types/collectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || null, type_category_id: newCatId || null }),
      });
      const created = await res.json();
      setNewName(''); setNewDesc(''); setNewCatId('');
      reload();
      setSelectedId(created.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const deleteCollector = async (id: number) => {
    if (!confirm('Delete this collector? Its global types will be unassigned.')) return;
    await fetch(`/api/global_types/collectors/${id}`, { method: 'DELETE' });
    if (selectedId === id) setSelectedId(null);
    reload();
  };

  const saveCollectorCategory = async () => {
    if (!selected) return;
    setSavingCat(true);
    try {
      await fetch(`/api/global_types/collectors/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type_category_id: editCatId || null }),
      });
      reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingCat(false);
    }
  };

  const createCategory = async () => {
    if (!newCatName.trim()) return;
    setCreatingCat(true);
    try {
      await fetch('/api/global_types/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCatName.trim() }),
      });
      setNewCatName('');
      reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreatingCat(false);
    }
  };

  const deleteCategory = async (id: number, name: string) => {
    if (!confirm(`Delete category "${name}"? Collectors in this category will become uncategorized.`)) return;
    await fetch(`/api/global_types/categories/${id}`, { method: 'DELETE' });
    reload();
  };

  if (loading) return <div className="text-muted small">Loading…</div>;
  if (error) return <div className="alert alert-danger small">{error}</div>;

  return (
    <div>
      <p className="text-muted small mb-3">
        Manage categories and collectors. Assign global type codes to collectors, and collectors to categories.
        Collectors appear as filter buttons on the Hotels page.
      </p>

      {/* ── Categories ── */}
      <div className="border rounded p-3 mb-4 bg-light">
        <div className="fw-semibold small mb-2">Categories</div>
        <div className="d-flex flex-wrap gap-2 mb-2">
          {categories.length === 0 && <span className="text-muted small fst-italic">No categories yet</span>}
          {categories.map(cat => (
            <span key={cat.id} className="badge bg-secondary d-flex align-items-center gap-1" style={{ fontSize: '0.85rem' }}>
              {cat.global_type_category}
              <button
                type="button"
                className="btn-close btn-close-white ms-1"
                style={{ fontSize: '0.55rem' }}
                onClick={() => deleteCategory(cat.id, cat.global_type_category)}
                aria-label="Delete category"
              />
            </span>
          ))}
        </div>
        <div className="d-flex gap-2">
          <input
            className="form-control form-control-sm"
            style={{ maxWidth: 220 }}
            placeholder="New category name"
            value={newCatName}
            onChange={e => setNewCatName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createCategory(); }}
          />
          <button className="btn btn-sm btn-outline-primary" onClick={createCategory} disabled={creatingCat || !newCatName.trim()}>
            {creatingCat ? 'Adding…' : '+ Add'}
          </button>
        </div>
      </div>

      <div className="row g-3">
        {/* ── collector list + create ── */}
        <div className="col-md">
          <div className="border rounded p-2 mb-2 bg-light">
            <div className="fw-semibold small mb-2">New Collector</div>
            <input className="form-control form-control-sm mb-1" placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} />
            <input className="form-control form-control-sm mb-1" placeholder="Description (optional)" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
            <select className="form-select form-select-sm mb-2" value={newCatId} onChange={e => setNewCatId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— No category —</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.global_type_category}</option>)}
            </select>
            <button className="btn btn-sm btn-primary w-100" onClick={createCollector} disabled={creating || !newName.trim()}>
              {creating ? 'Creating…' : '+ Create'}
            </button>
          </div>

          <div className="list-group" style={{ maxHeight: 360, overflowY: 'auto' }}>
            {collectors.length === 0 && (
              <div className="list-group-item text-muted small fst-italic">No collectors yet</div>
            )}
            {(() => {
              const groups = new Map<string, Collector[]>();
              for (const c of collectors) {
                const cat = c.global_type_category ?? '(Uncategorized)';
                if (!groups.has(cat)) groups.set(cat, []);
                groups.get(cat)!.push(c);
              }
              return Array.from(groups.entries()).map(([cat, items]) => (
                <React.Fragment key={cat}>
                  <div className="list-group-item list-group-item-secondary py-1 px-3 small fw-semibold text-muted" style={{ fontSize: '0.7rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    {cat}
                  </div>
                  {items.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      className={`list-group-item list-group-item-action py-2 px-3 ${selectedId === c.id ? 'active' : ''}`}
                      onClick={() => { setSelectedId(c.id); setSearchTerm(''); }}
                    >
                      <div className="d-flex justify-content-between align-items-center">
                        <span className="small fw-semibold">{toTitleCase(c.name)}</span>
                        <div className="d-flex gap-1 align-items-center">
                          <span className="badge bg-secondary rounded-pill">{effectiveTypes(c).length}</span>
                          <button
                            type="button"
                            className={`btn btn-sm p-0 ms-1 ${selectedId === c.id ? 'text-white' : 'text-danger'}`}
                            style={{ lineHeight: 1 }}
                            onClick={e => { e.stopPropagation(); deleteCollector(c.id); }}
                            title="Delete collector"
                          >
                            <i className="fas fa-trash-can" style={{ fontSize: '0.7rem' }} />
                          </button>
                        </div>
                      </div>
                    </button>
                  ))}
                </React.Fragment>
              ));
            })()}
          </div>
        </div>

        {/* ── collector detail ── */}
        <div className="col-md">
          {selected ? (
            <>
              <div className="fw-semibold mb-1">{toTitleCase(selected.name)}</div>
              {selected.description && <div className="text-muted small mb-2">{selected.description}</div>}

              {/* Category assignment */}
              <div className="d-flex align-items-center gap-2 mb-3">
                <label className="form-label mb-0 small text-muted text-nowrap">Category:</label>
                <select
                  className="form-select form-select-sm"
                  value={editCatId}
                  onChange={e => setEditCatId(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">— None —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.global_type_category}</option>)}
                </select>
                <button
                  className="btn btn-sm btn-outline-secondary text-nowrap"
                  onClick={saveCollectorCategory}
                  disabled={savingCat || editCatId === (selected.type_category_id ?? '')}
                >
                  {savingCat ? 'Saving…' : 'Save'}
                </button>
              </div>

              <div className="fw-semibold small text-muted mb-1">Assigned global types</div>
              <div className="d-flex flex-wrap gap-1 mb-3 p-2 border rounded" style={{ minHeight: 42 }}>
                {effectiveTypes(selected).map(gt => (
                  <span key={gt} className="badge bg-secondary d-flex align-items-center gap-1" style={{ fontSize: '0.8rem' }}>
                    {gt}
                    <button type="button" className="btn-close btn-close-white ms-1" style={{ fontSize: '0.55rem' }}
                      onClick={() => assign(gt, null)} aria-label="Remove" />
                  </span>
                ))}
                {effectiveTypes(selected).length === 0 && (
                  <span className="text-muted small fst-italic">No types assigned</span>
                )}
              </div>

              <div className="fw-semibold small text-muted mb-1">Add unassigned global types</div>
              <input className="form-control form-control-sm mb-2" placeholder="Search by code or label…"
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
              <div style={{ maxHeight: 220, overflowY: 'auto' }} className="border rounded">
                {filteredUnassigned.length === 0 && (
                  <div className="p-2 text-muted small fst-italic">No unassigned types{searchTerm ? ' matching search' : ''}</div>
                )}
                {filteredUnassigned.map(u => (
                  <button key={u.global_type} type="button"
                    className="btn btn-link btn-sm w-100 text-start text-decoration-none px-3 py-1 border-bottom text-body"
                    onClick={() => assign(u.global_type, selected.id)}
                  >
                    {u.global_type} — {u.global_type_label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="text-muted small fst-italic mt-2">Select a collector to manage its category and global types</div>
          )}
        </div>
      </div>

      <div className="d-flex align-items-center gap-2 mt-3 pt-3 border-top">
        <button className="btn btn-primary btn-sm" onClick={saveAssignments} disabled={saving || pending.size === 0}>
          {saving ? 'Saving…' : `Save Assignments${pending.size > 0 ? ` (${pending.size})` : ''}`}
        </button>
        {pending.size > 0 && <span className="text-warning small"><i className="fas fa-circle-exclamation me-1" />Unsaved changes</span>}
        {savedMsg && <span className="text-success small"><i className="fas fa-check me-1" />Saved</span>}
      </div>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [fields, setFields] = React.useState<CookieMap>({});
  const [saved, setSaved] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<TestResult | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetchJSON('/api/settings?key=booking_com_cookies')
      .then(d => setFields(parseCookieString(d.value || '')))
      .catch(e => setLoadError(e.message));
  }, []);

  const setField = (name: string, value: string) => {
    setFields(prev => ({ ...prev, [name]: value }));
    setSaved(false);
    setTestResult(null);
  };

  const cookieString = buildCookieString(fields);
  const hasAnyCookie = cookieString.trim().length > 0;

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'booking_com_cookies', value: cookieString }),
      });
      setSaved(true);
      setTestResult(null);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/booking-cookies/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: cookieString }),
      });
      setTestResult(await res.json());
    } catch (e: any) {
      setTestResult({ loggedIn: false, error: e.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <main>
      <h4 className="mb-4">Settings</h4>

      {/* ── Booking cookies ── */}
      <div className="card mb-4" >
        <div className="card-header fw-semibold">Booking.com Cookies</div>
        <div className="card-body">
          <p className="text-muted small mb-4">
            Enter each cookie value from a logged-in Booking.com session. Used by the
            <strong> Booking (Member)</strong> scan source to retrieve Genius member pricing.
            <br />
            In Chrome: open booking.com → F12 → Application → Cookies → <code>https://www.booking.com</code>.
          </p>

          {loadError && <div className="alert alert-danger small">{loadError}</div>}

          <div className="mb-4">
            {COOKIE_FIELDS.map(f => (
              <div key={f.name} className="row align-items-start mb-2">
                <label className="col-sm-3 col-form-label col-form-label-sm fw-semibold font-monospace pt-1">
                  {f.label}
                </label>
                <div className="col-sm-9">
                  <input
                    type="text"
                    className="form-control form-control-sm font-monospace"
                    value={fields[f.name] || ''}
                    onChange={e => setField(f.name, e.target.value)}
                    placeholder={`${f.name}=…`}
                    spellCheck={false}
                  />
                  <div className="form-text">{f.hint}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="d-flex gap-2 align-items-center flex-wrap">
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !hasAnyCookie}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-outline-secondary btn-sm" onClick={handleTest} disabled={testing || !hasAnyCookie}>
              {testing
                ? <><span className="spinner-border spinner-border-sm me-1" />Testing…</>
                : 'Test Login'}
            </button>
            {saved && <span className="text-success small"><i className="fas fa-check me-1" />Saved</span>}
          </div>

          {testResult && (
            <div className={`alert mt-3 mb-0 ${testResult.error ? 'alert-warning' : testResult.loggedIn ? 'alert-success' : 'alert-danger'}`}>
              {testResult.error
                ? <><i className="fas fa-triangle-exclamation me-1" /><strong>Error:</strong> {testResult.error}</>
                : testResult.loggedIn
                  ? <><i className="fas fa-circle-check me-1" /><strong>Logged in</strong> — cookies are valid.</>
                  : <><i className="fas fa-circle-xmark me-1" /><strong>Not logged in</strong> — cookies appear expired or invalid.</>}
              {testResult.indicators && (
                <div className="mt-1 small text-muted">
                  Genius element: {testResult.indicators.hasGenius ? '✓' : '✗'} ·
                  Avatar element: {testResult.indicators.hasAvatar ? '✓' : '✗'} ·
                  Sign-in text: {testResult.indicators.signInTextFound ? 'found' : 'not found'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Global type collectors ── */}
      <div className="card mb-4" style={{ marginTop: '1rem' }}>
        <div className="card-header fw-semibold">Global Type Collectors</div>
        <div className="card-body">
          <CollectorsSection />
        </div>
      </div>
    </main>
  );
}
