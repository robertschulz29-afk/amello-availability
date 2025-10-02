// app/page.tsx
'use client';

import * as React from 'react';

type ResultsMatrix = {
  scanId: number;
  scannedAt: string;
  dates: string[];
  results: Record<string, Record<string, 'green' | 'red'>>;
};

async function fetchJSON(input: RequestInfo, init?: RequestInit) {
  const r = await fetch(input, init);
  const text = await r.text();
  if (!r.ok) {
    try {
      const j = JSON.parse(text);
      throw new Error(j.error || r.statusText);
    } catch {
      throw new Error(text || r.statusText);
    }
  }
  return text ? JSON.parse(text) : null;
}

export default function Page() {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [progress, setProgress] = React.useState<{
    scanId?: number;
    total?: number;
    done?: number;
    status?: 'queued' | 'running' | 'done' | 'error';
  }>({});

  const [matrix, setMatrix] = React.useState<ResultsMatrix | null>(null);

  const startScan = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    setMatrix(null);
    setProgress({});

    try {
      // 1) Kickoff
      const kick = await fetchJSON('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // You can override here if needed:
        // body: JSON.stringify({ startOffset: 5, endOffset: 90, stayNights: 7 }),
      });
      const scanId = Number(kick?.scanId);
      const total = Number(kick?.totalCells ?? 0);
      if (!Number.isFinite(scanId) || scanId <= 0) throw new Error('Invalid scanId from server');
      setProgress({ scanId, total, done: 0, status: 'running' });

      // 2) Process in batches
      let idx = 0;
      const size = 50; // tune 25..100
      while (true) {
        const r = await fetchJSON('/api/scans/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scanId, startIndex: idx, size }),
        });
        idx = Number(r?.nextIndex ?? idx);
        const processed = Number(r?.processed ?? 0);
        const doneFlag = Boolean(r?.done);
        setProgress((prev) => ({
          scanId,
          total,
          done: Math.min((prev.done ?? 0) + processed, total),
          status: doneFlag ? 'done' : 'running',
        }));
        if (doneFlag) break;
        // optional small delay to be nice to upstream
        // await new Promise(res => setTimeout(res, 150));
      }

      // 3) Load final matrix
      const data = await fetchJSON(`/api/scans/${scanId}`, { cache: 'no-store' });

      const safeDates: string[] = Array.isArray(data?.dates) ? data.dates : [];
      const safeResults: Record<string, Record<string, 'green' | 'red'>> =
        data && typeof data.results === 'object' && data.results !== null ? data.results : {};

      setMatrix({
        scanId,
        scannedAt: String(data?.scannedAt ?? ''),
        dates: safeDates,
        results: safeResults,
      });
    } catch (e: any) {
      setError(e?.message || 'Scan failed');
      setProgress((p) => ({ ...p, status: 'error' }));
    } finally {
      setBusy(false);
    }
  }, []);

  // Render helpers
  const dates = matrix?.dates ?? []; // never undefined
  const hotelCodes = React.useMemo(() => Object.keys(matrix?.results ?? {}), [matrix]);
  const cell = (code: string, date: string): 'green' | 'red' | undefined =>
    matrix?.results?.[code]?.[date];

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Availability Scan</h1>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button onClick={startScan} disabled={busy} style={{ padding: '8px 12px' }}>
          {busy ? 'Running…' : 'Start scan'}
        </button>
        {progress.scanId ? (
          <div>
            Scan #{progress.scanId}:{' '}
            <strong>{progress.done ?? 0}/{progress.total ?? 0}</strong>{' '}
            ({progress.status})
          </div>
        ) : null}
      </div>

      {error ? (
        <p style={{ color: 'crimson', marginTop: 12 }}>{error}</p>
      ) : null}

      {/* Only render the table when we have dates and at least one hotel code */}
      {dates.length > 0 && hotelCodes.length > 0 ? (
        <div style={{ marginTop: 16, overflow: 'auto', border: '1px solid #eee' }}>
          <table cellPadding={4} cellSpacing={0} style={{ borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, background: '#fff', borderBottom: '1px solid #ddd', textAlign: 'left' }}>
                  Hotel
                </th>
                {dates.map((d) => (
                  <th key={d} style={{ borderBottom: '1px solid #ddd', whiteSpace: 'nowrap' }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hotelCodes.map((code) => (
                <tr key={code}>
                  <td style={{ position: 'sticky', left: 0, background: '#fff', borderRight: '1px solid #eee' }}>{code}</td>
                  {dates.map((d) => {
                    const s = cell(code, d);
                    const bg = s === 'green' ? '#d4edda' : s === 'red' ? '#f8d7da' : '#f0f0f0';
                    return (
                      <td key={code + d} style={{ background: bg, textAlign: 'center', borderBottom: '1px solid #f1f1f1' }}>
                        {s ?? ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ marginTop: 16, opacity: 0.7 }}>
          {busy || progress.status === 'running'
            ? 'Scanning… progress will update here.'
            : 'No results yet. Start a scan to populate the table.'}
        </p>
      )}
    </main>
  );
}
