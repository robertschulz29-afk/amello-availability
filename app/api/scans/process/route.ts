// app/api/scans/process/route.ts
// Legacy orchestrator — kept for backward compatibility with old scan records.
// New scans use scan_source_jobs and call /api/scans/process/{source} directly.
// This route now simply logs and returns done for any scan that has no pending source jobs.

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { DEFAULT_BELLO_MANDATOR } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function getBaseUrl(): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

function parseSources(raw: unknown): string[] | null {
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string');
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const belloMandator = req.headers.get('Bello-Mandator') || DEFAULT_BELLO_MANDATOR;

  try {
    const body = await req.json().catch(() => ({}));
    const scanId = Number(body?.scanId);

    if (!Number.isFinite(scanId) || scanId <= 0) {
      return NextResponse.json({ error: 'Invalid scanId' }, { status: 400 });
    }

    // Check if this scan already has source jobs (new architecture)
    const jobsQ = await sql`
      SELECT id, source, done_cells, total_cells, status FROM scan_source_jobs WHERE scan_id = ${scanId}
    `;

    if (jobsQ.rows.length > 0) {
      // New architecture: source jobs handle everything — nothing to do here
      console.log(`[process] Scan ${scanId} uses source jobs — orchestrator is a no-op`);
      const allDone = jobsQ.rows.every((j: any) => j.status === 'done' || j.status === 'cancelled');
      return NextResponse.json({ done: allDone, message: 'Source jobs handle this scan' });
    }

    // Legacy path: scan has no source jobs — use old orchestration
    const s = await sql`SELECT id, status FROM scans WHERE id = ${scanId}`;
    if (!s.rows.length) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
    if (s.rows[0].status === 'cancelled') {
      return NextResponse.json({ processed: 0, done: true, message: 'Scan cancelled' });
    }

    const startIndex = Number.isFinite(body?.startIndex) ? Number(body.startIndex) : 0;
    const size = Math.max(1, Math.min(200, Number.isFinite(body?.size) ? Number(body.size) : 50));

    let amelloEnabled = false;
    let bookingEnabled = false;

    const bodySources = parseSources(body?.sources);
    if (bodySources !== null) {
      amelloEnabled  = bodySources.includes('amello');
      bookingEnabled = bodySources.includes('booking');
    } else {
      try {
        const q = await sql`SELECT sources::text AS sources_raw FROM scans WHERE id = ${scanId}`;
        const dbSources = parseSources(q.rows[0]?.sources_raw);
        if (dbSources !== null) {
          amelloEnabled  = dbSources.includes('amello');
          bookingEnabled = dbSources.includes('booking');
        }
      } catch { /* nothing runs */ }
    }

    if (!amelloEnabled && !bookingEnabled) {
      await sql`UPDATE scans SET status = 'done' WHERE id = ${scanId}`;
      return NextResponse.json({ done: true, processed: 0, total: 0 });
    }

    // For legacy scans, create source jobs on-the-fly so process-next can pick them up
    const baseUrl = getBaseUrl();
    const results: Record<string, any> = {};

    async function runLegacySource(source: string) {
      try {
        const res = await fetch(`${baseUrl}/api/scans/process/${source}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Bello-Mandator': belloMandator },
          body: JSON.stringify({ scanId, startIndex, size }),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        return await res.json();
      } catch (e: any) {
        return { error: e.message, processed: 0, done: false };
      }
    }

    const [amello, booking] = await Promise.all([
      amelloEnabled  ? runLegacySource('amello')  : Promise.resolve({ processed: 0, done: true, skipped: true }),
      bookingEnabled ? runLegacySource('booking') : Promise.resolve({ processed: 0, done: true, skipped: true }),
    ]);

    results.amello  = amello;
    results.booking = booking;

    const done = amello.done === true && booking.done === true;

    if (done) {
      await sql`UPDATE scans SET status = 'done' WHERE id = ${scanId} AND status != 'cancelled'`;
    }

    return NextResponse.json({ done, amello, booking, nextIndex: amello.nextIndex ?? startIndex + size });

  } catch (e: any) {
    console.error('[process] fatal', e);
    return NextResponse.json({ error: 'Orchestrator error' }, { status: 500 });
  }
}
