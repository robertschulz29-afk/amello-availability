// app/page.tsx (relevant excerpts)

async function fetchJSON(input: RequestInfo, init?: RequestInit) {
  const r = await fetch(input, init);
  const text = await r.text();
  if (!r.ok) {
    try { const j = JSON.parse(text); throw new Error(j.error || r.statusText); }
    catch { throw new Error(text || r.statusText); }
  }
  return text ? JSON.parse(text) : null;
}

export default function Page() {
  const [progress, setProgress] = React.useState<{scanId?:number,total?:number,done?:number,status?:string}>({});

  const startScan = async () => {
    setProgress({}); // reset UI
    // 1) Kickoff
    const kick = await fetchJSON('/api/scans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // You can pass overrides here if needed:
      body: JSON.stringify({ /* startOffset:5, endOffset:90, stayNights:7 */ }),
    });
    const scanId = kick.scanId as number;
    const total = kick.totalCells as number;

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
      idx = r.nextIndex;
      setProgress(prev => ({ ...prev, done: Math.min((prev.done ?? 0) + r.processed, total), status: r.done ? 'done' : 'running' }));
      if (r.done) break;
      // (optional) small delay to avoid hammering
      // await new Promise(res => setTimeout(res, 200));
    }

    // 3) Load matrix and render (if you have a table component)
    // const data = await fetchJSON(`/api/scans/${scanId}`, { cache: 'no-store' });
    // setYourState(data);
  };

  return (
    <main>
      <button onClick={startScan}>Start scan</button>
      {progress.scanId && (
        <p>Scan #{progress.scanId}: {progress.done}/{progress.total} {progress.status}</p>
      )}
      {/* ... your table ... */}
    </main>
  );
}
