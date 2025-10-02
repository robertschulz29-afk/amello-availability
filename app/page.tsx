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
      if (!Number.isFinite(scanId) || scanId <= 0) throw new Error('Invalid scanId from server
