'use client';

import * as React from 'react';
import { fetchJSON } from '@/lib/api-client';

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
    </main>
  );
}
