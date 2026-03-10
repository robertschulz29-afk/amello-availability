// app/api/scans/process/route.ts
// Orchestrator: fires Amello and Booking sub-routes in parallel for each batch.
// The frontend calls this repeatedly with increasing startIndex until done=true.

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

async function callSubRoute(
  path: string,
  body: Record<string, any>,
  headers: Record<string, string>
): Promise<any> {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path} responded ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export async function POST(req: NextRequest) {
  console.log('[process] ===== ORCHESTRATOR START =====', new Date().toISOString());

  const belloMandator = req.headers.get('Bello-Mandator') || DEFAULT_BELLO_MANDATOR;

  try {
    const body = await req.json().catch(() => ({}));
    const scanId = Number(body?.scanId);
    const startIndex = Number.isFinite(body?.startIndex) ? Number(body.startIndex) : 0;
    const size = Math.max(1, Math.min(200, Number.isFinite(body?.size) ? Number(body.size) : 50));

    if (!Number.isFinite(scanId) || scanId <= 0) {
      return NextResponse.json({ error: 'Invalid scanId' }, { status: 400 });
    }

    // Check scan exists and isn't cancelled
    const s = await sql`SELECT id, status FROM scans WHERE id = ${scanId}`;
    if (!s.rows.length) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
    if (s.rows[0].status === 'cancelled') {
      return NextResponse.json({ processed: 0, done: true, message: 'Scan cancelled' });
    }

    const subBody = { scanId, startIndex, size };
    const subHeaders = { 'Bello-Mandator': belloMandator };

    console.log(`[process] Firing Amello + Booking in parallel | scanId=${scanId} startIndex=${startIndex} size=${size}`);

    // Fire both sub-routes in parallel — they are fully independent
    const [amelloResult, bookingResult] = await Promise.allSettled([
      callSubRoute('/api/scans/process/amello', subBody, subHeaders),
      callSubRoute('/api/scans/process/booking', subBody, subHeaders),
    ]);

    const amello = amelloResult.status === 'fulfilled'
      ? amelloResult.value
      : { error: (amelloResult as PromiseRejectedResult).reason?.message, processed: 0, done: false };

    const booking = bookingResult.status === 'fulfilled'
      ? bookingResult.value
      : { error: (bookingResult as PromiseRejectedResult).reason?.message, processed: 0, done: false };

    if (amelloResult.status === 'rejected') {
      console.error('[process] Amello sub-route failed:', amello.error);
    }
    if (bookingResult.status === 'rejected') {
      console.error('[process] Booking sub-route failed:', booking.error);
    }

    // Done when both sub-routes report done
    const done = (amello.done === true) && (booking.done === true || booking.error);

    // Mark scan done when complete
    if (done) {
      const total = amello.total ?? 0;
      const curDone = (await sql`SELECT done_cells FROM scans WHERE id = ${scanId}`).rows[0]?.done_cells ?? 0;
      if (curDone >= total) {
        await sql`UPDATE scans SET status = 'done' WHERE id = ${scanId}`;
        console.log(`[process] Scan ${scanId} marked as done`);

        // Sync room names from this scan into hotel_room_names.
        // Scoped to this scan_id only — fast regardless of total scan history.
        await sql`
          INSERT INTO hotel_room_names (hotel_id, source, room_name, last_seen_at)
          SELECT DISTINCT sr.hotel_id, sr.source, elem->>'name', NOW()
          FROM scan_results sr,
               jsonb_array_elements(sr.response_json->'rooms') AS elem
          WHERE sr.scan_id = ${scanId}
            AND sr.status  = 'green'
            AND elem->>'name' IS NOT NULL
          ON CONFLICT (hotel_id, source, room_name)
            DO UPDATE SET last_seen_at = NOW()
        `;
        console.log(`[process] Scan ${scanId} room names synced`);
      }
    }

    console.log('[process] ===== ORCHESTRATOR COMPLETE =====');
    console.log('[process] Amello:', JSON.stringify(amello));
    console.log('[process] Booking:', JSON.stringify(booking));

    return NextResponse.json({
      done,
      nextIndex: amello.nextIndex ?? startIndex + size,
      total: amello.total,
      amello,
      booking,
    });

  } catch (e: any) {
    console.error('[process] fatal', e);
    return NextResponse.json({ error: 'Orchestrator error' }, { status: 500 });
  }
}
