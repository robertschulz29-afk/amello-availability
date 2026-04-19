// app/api/scans/process-next/route.ts
// Cron tick: pick the next incomplete source job and kick off one batch.
// Each source is processed independently — no orchestrator fan-out needed.

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { DEFAULT_BELLO_MANDATOR } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getBaseUrl(): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export async function GET(req: NextRequest) { return processNext(req); }
export async function POST(req: NextRequest) { return processNext(req); }

async function processNext(req: NextRequest) {
  console.log('[process-next] CRON tick', new Date().toISOString());

  try {
    // Pick the oldest incomplete running source job
    const jobQ = await sql`
      SELECT j.id AS job_id, j.scan_id, j.source, j.done_cells, j.total_cells
      FROM scan_source_jobs j
      JOIN scans s ON s.id = j.scan_id
      WHERE j.status = 'running'
        AND j.done_cells < j.total_cells
        AND s.status NOT IN ('cancelled', 'done', 'error')
      ORDER BY j.created_at ASC
      LIMIT 1
    `;

    if (jobQ.rows.length === 0) {
      return NextResponse.json({ message: 'No source jobs to process', processed: 0 });
    }

    const job = jobQ.rows[0];
    const { job_id: jobId, scan_id: scanId, source, done_cells: doneCells, total_cells: totalCells } = job;

    console.log(`[process-next] Job #${jobId} scan=${scanId} source=${source} progress=${doneCells}/${totalCells}`);

    const belloMandator = req.headers.get('Bello-Mandator') || DEFAULT_BELLO_MANDATOR;
    const url = `${getBaseUrl()}/api/scans/process/${source}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Bello-Mandator': belloMandator },
      body: JSON.stringify({ jobId, startIndex: doneCells, size: 50 }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`[process-next] ${source} route failed:`, response.status, errorText.slice(0, 200));
      return NextResponse.json({ error: 'Processing failed', status: response.status }, { status: 500 });
    }

    const result = await response.json();
    console.log(`[process-next] Job #${jobId} source=${source} done=${result.done} processed=${result.processed ?? 0}`);

    return NextResponse.json({
      jobId, scanId, source,
      processed: result.processed ?? 0,
      done: result.done ?? false,
      total: totalCells,
    });

  } catch (e: unknown) {
    console.error('[process-next] fatal:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 });
  }
}
