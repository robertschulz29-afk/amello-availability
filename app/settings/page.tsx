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

// ─── Global type filter groups ────────────────────────────────────────────────

type GlobalTypeRow = {
  global_type: string;
  type_description: string | null;
  type_category: string | null;
  filter_group: string | null;
  global_type_category: string | null;
};

function useFilterGroups() {
  const [rows, setRows] = React.useState<GlobalTypeRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // local pending changes: global_type → new filter_group (null = remove)
  const [pending, setPending] = React.useState<Map<string, string | null>>(new Map());
  const [saving, setSaving] = React.useState(false);
  const [savedMsg, setSavedMsg] = React.useState(false);

  React.useEffect(() => {
    fetchJSON('/api/global_types/filter-groups')
      .then(data => setRows(Array.isArray(data) ? data : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const effectiveGroup = (gt: GlobalTypeRow): string | null =>
    pending.has(gt.global_type) ? pending.get(gt.global_type)! : gt.filter_group;

  const assign = (global_type: string, filter_group: string | null) =>
    setPending(prev => new Map(prev).set(global_type, filter_group));

  const save = async () => {
    setSaving(true);
    setSavedMsg(false);
    try {
      const assignments = [...pending.entries()].map(([global_type, filter_group]) => ({ global_type, filter_group }));
      await fetch('/api/global_types/filter-groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments }),
      });
      // commit pending into rows
      setRows(prev => prev.map(r =>
        pending.has(r.global_type) ? { ...r, filter_group: pending.get(r.global_type)! } : r,
      ));
      setPending(new Map());
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return { rows, loading, error, effectiveGroup, assign, pending, save, saving, savedMsg };
}

function FilterGroupsSection() {
  const { rows, loading, error, effectiveGroup, assign, pending, save, saving, savedMsg } = useFilterGroups();
  const [newGroupName, setNewGroupName] = React.useState('');
  const [selectedGroup, setSelectedGroup] = React.useState<string | null>(null);
  const [searchTerm, setSearchTerm] = React.useState('');

  // Derive groups from current effective assignments
  const groupNames = React.useMemo(() => {
    const names = new Set<string>();
    for (const r of rows) {
      const g = effectiveGroup(r);
      if (g) names.add(g);
    }
    return [...names].sort();
  }, [rows, pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const typesByGroup = React.useMemo(() => {
    const map = new Map<string, GlobalTypeRow[]>();
    for (const r of rows) {
      const g = effectiveGroup(r);
      if (g) {
        const arr = map.get(g) ?? [];
        arr.push(r);
        map.set(g, arr);
      }
    }
    return map;
  }, [rows, pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const unassigned = React.useMemo(
    () => rows.filter(r => !effectiveGroup(r)),
    [rows, pending], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const filteredUnassigned = unassigned.filter(r =>
    !searchTerm || (r.type_description ?? r.global_type).toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const addGroup = () => {
    const name = newGroupName.trim();
    if (!name || groupNames.includes(name)) return;
    setSelectedGroup(name);
    setNewGroupName('');
  };

  if (loading) return <div className="text-muted small">Loading global types…</div>;
  if (error) return <div className="alert alert-danger small">{error}</div>;

  return (
    <div>
      <p className="text-muted small mb-3">
        Define filter groups (e.g. "All Inclusive") and assign global types to them.
        Groups appear as sub-labels in the hotel filter panel.
      </p>

      <div className="row g-3">
        {/* ── group list ── */}
        <div className="col-md-4">
          <div className="d-flex gap-2 mb-2">
            <input
              type="text"
              className="form-control form-control-sm"
              placeholder="New group name…"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addGroup()}
            />
            <button className="btn btn-sm btn-outline-primary text-nowrap" onClick={addGroup} disabled={!newGroupName.trim()}>
              + Add
            </button>
          </div>
          <div className="list-group" style={{ maxHeight: 400, overflowY: 'auto' }}>
            {groupNames.map(g => (
              <button
                key={g}
                type="button"
                className={`list-group-item list-group-item-action d-flex justify-content-between align-items-center py-2 ${selectedGroup === g ? 'active' : ''}`}
                onClick={() => setSelectedGroup(g)}
              >
                <span className="small fw-semibold">{g}</span>
                <span className="badge bg-secondary rounded-pill ms-2">
                  {typesByGroup.get(g)?.length ?? 0}
                </span>
              </button>
            ))}
            {groupNames.length === 0 && (
              <div className="list-group-item text-muted small fst-italic">No groups defined</div>
            )}
          </div>
        </div>

        {/* ── group detail ── */}
        <div className="col-md-8">
          {selectedGroup ? (
            <>
              <div className="fw-semibold mb-2">{selectedGroup}</div>
              <div className="d-flex flex-wrap gap-1 mb-3 p-2 border rounded" style={{ minHeight: 42 }}>
                {(typesByGroup.get(selectedGroup) ?? []).map(r => (
                  <span key={r.global_type} className="badge bg-secondary d-flex align-items-center gap-1" style={{ fontSize: '0.8rem' }}>
                    {r.type_description || r.global_type}
                    <button
                      type="button"
                      className="btn-close btn-close-white ms-1"
                      style={{ fontSize: '0.55rem' }}
                      onClick={() => assign(r.global_type, null)}
                      aria-label="Remove"
                    />
                  </span>
                ))}
                {(typesByGroup.get(selectedGroup) ?? []).length === 0 && (
                  <span className="text-muted small fst-italic">No types assigned — pick from the list below</span>
                )}
              </div>

              <div className="fw-semibold small text-muted mb-1">Add from unassigned types</div>
              <input
                type="text"
                className="form-control form-control-sm mb-2"
                placeholder="Search types…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
              <div style={{ maxHeight: 220, overflowY: 'auto' }} className="border rounded">
                {filteredUnassigned.length === 0 && (
                  <div className="p-2 text-muted small fst-italic">No unassigned types{searchTerm ? ' matching search' : ''}</div>
                )}
                {filteredUnassigned.map(r => (
                  <button
                    key={r.global_type}
                    type="button"
                    className="btn btn-link btn-sm w-100 text-start text-decoration-none px-3 py-1 border-bottom"
                    onClick={() => assign(r.global_type, selectedGroup)}
                  >
                    <span className="text-body">{r.type_description || r.global_type}</span>
                    {r.global_type_category && (
                      <span className="text-muted ms-2 small">({r.global_type_category})</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="text-muted small fst-italic mt-2">Select a group to manage its types</div>
          )}
        </div>
      </div>

      {/* ── save bar ── */}
      <div className="d-flex align-items-center gap-2 mt-3 pt-3 border-top">
        <button
          className="btn btn-primary btn-sm"
          onClick={save}
          disabled={saving || pending.size === 0}
        >
          {saving ? 'Saving…' : `Save Changes${pending.size > 0 ? ` (${pending.size})` : ''}`}
        </button>
        {pending.size > 0 && (
          <span className="text-warning small"><i className="fas fa-circle-exclamation me-1" />Unsaved changes</span>
        )}
        {savedMsg && (
          <span className="text-success small"><i className="fas fa-check me-1" />Saved</span>
        )}
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
      <div className="card mb-4" style={{ maxWidth: 760 }}>
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

      {/* ── Global type filter groups ── */}
      <div className="card mb-4" style={{ maxWidth: 900 }}>
        <div className="card-header fw-semibold">Global Type Filter Groups</div>
        <div className="card-body">
          <FilterGroupsSection />
        </div>
      </div>
    </main>
  );
}
