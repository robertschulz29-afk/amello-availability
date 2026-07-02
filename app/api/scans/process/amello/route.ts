// app/api/scans/process/amello/route.ts
// Processes one batch of Amello API calls for a given scan_source_job.
// Receives: { jobId, startIndex, size }

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { extractRoomRateData } from '@/lib/price-utils';
import { DEFAULT_BELLO_MANDATOR, SCAN_BATCH_SIZE } from '@/lib/constants';
import {
  toYMDUTC, normalizeYMD, ymdToUTC, datesFromBase, markJobDone, type ScanCell,
} from '@/lib/scrapers/process-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BASE_URL = process.env.AMELLO_BASE_URL || 'https://prod-api.amello.plusline.net/api/v1';
const CONCURRENCY = 4;

export async function POST(req: NextRequest) {
  const tStart = Date.now();
  const belloMandator = req.headers.get('Bello-Mandator') || DEFAULT_BELLO_MANDATOR;

  try {
    const body = await req.json().catch(() => ({}));
    const jobId = Number(body?.jobId);
    const startIndex = Number.isFinite(body?.startIndex) ? Number(body.startIndex) : 0;
    const size = Math.max(1, Math.min(200, Number.isFinite(body?.size) ? Number(body.size) : 50));

    if (!Number.isFinite(jobId) || jobId <= 0) {
      return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });
    }

    // Load source job + parent scan
    const jobQ = await sql`
      SELECT j.id, j.scan_id, j.status AS job_status, j.total_cells,
             s.base_checkin::text AS base_checkin, s.days, s.stay_nights, s.status AS scan_status,
             s.adult_count
      FROM scan_source_jobs j
      JOIN scans s ON s.id = j.scan_id
      WHERE j.id = ${jobId} AND j.source = 'amello'
    `;

    if (!jobQ.rows.length) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const job = jobQ.rows[0];

    if (job.scan_status === 'cancelled' || job.job_status === 'cancelled') {
      return NextResponse.json({ processed: 0, done: true, message: 'Cancelled' });
    }

    const scanId = job.scan_id as number;

    // Build date list
    const baseYMD = normalizeYMD(job.base_checkin);
    const daysNum = Number(job.days);
    const dates: string[] = baseYMD && Number.isFinite(daysNum) && daysNum > 0
      ? datesFromBase(baseYMD, daysNum) : [];

    if (!dates.length) {
      return NextResponse.json({ error: 'No dates to process' }, { status: 400 });
    }

    const hotels = (await sql`
      SELECT sh.hotel_id AS id, h.code
      FROM scan_hotels sh
      JOIN hotels h ON h.id = sh.hotel_id
      WHERE sh.scan_id = ${scanId}
      ORDER BY sh.hotel_id ASC
    `).rows as Array<{ id: number; code: string }>;

    if (!hotels.length) {
      await sql`UPDATE scan_source_jobs SET done_cells = 0, updated_at = NOW() WHERE id = ${jobId}`;
      await markJobDone(jobId, scanId);
      return NextResponse.json({ processed: 0, done: true, total: 0, message: 'No hotels' });
    }

    const total = hotels.length * dates.length;
    const clampedStart = Math.max(0, Math.min(startIndex, total));
    const endIndex = Math.min(total, clampedStart + size);

    if (clampedStart >= endIndex) {
      await sql`UPDATE scan_source_jobs SET done_cells = ${total}, updated_at = NOW() WHERE id = ${jobId}`;
      await markJobDone(jobId, scanId);
      return NextResponse.json({ processed: 0, nextIndex: total, done: true, total });
    }

    const stayNights = Number(job.stay_nights) || 7;
    const adultCount = Math.max(1, Number(job.adult_count) || 2);
    const slice: ScanCell[] = [];

    for (let idx = clampedStart; idx < endIndex; idx++) {
      const h = hotels[Math.floor(idx / dates.length)];
      const checkIn = dates[idx % dates.length];
      const checkInDt = ymdToUTC(checkIn);
      checkInDt.setUTCDate(checkInDt.getUTCDate() + stayNights);
      slice.push({ hotelId: h.id, hotelCode: h.code, bookingUrl: null, checkIn, checkOut: toYMDUTC(checkInDt) });
    }

    let i = 0;
    let processed = 0;
    let failures = 0;

    async function worker() {
      while (true) {
        const idx = i++;
        if (idx >= slice.length) break;
        const cell = slice[idx];

        let status: 'green' | 'red' = 'red';
        let responseJson: any = null;

        try {
          const payload = {
            hotelId: cell.hotelCode,
            departureDate: cell.checkIn,
            returnDate: cell.checkOut,
            currency: 'EUR',
            roomConfigurations: [{ travellers: { id: 1, adultCount, childrenAges: [] } }],
            locale: 'en_DE',
          };

          const res = await fetch(`${BASE_URL}/hotel/offer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Bello-Mandator': belloMandator },
            body: JSON.stringify(payload),
            cache: 'no-store',
          });

          if (res.status === 200 && (res.headers.get('content-type') || '').includes('application/json')) {
            const j = await res.json();
            const compactData = extractRoomRateData(j);
            responseJson = { ...compactData, source: 'amello' };
            status = compactData.rooms?.length > 0 ? 'green' : 'red';
          } else {
            responseJson = { httpStatus: res.status, text: await res.text().catch(() => null), source: 'amello' };
          }
        } catch (e: any) {
          console.error('[amello] fetch error', e.message, cell);
          responseJson = { error: String(e), source: 'amello' };
        }

        try {
          await sql`
            INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status, response_json, source)
            VALUES (${scanId}, ${cell.hotelId}, ${cell.checkIn}, ${status}, ${responseJson}, 'amello')
            ON CONFLICT (scan_id, hotel_id, source, check_in_date)
            DO UPDATE SET status = EXCLUDED.status, response_json = EXCLUDED.response_json
          `;
          processed++;
        } catch (e: any) {
          failures++;
          console.error('[amello] DB write error', e.message);
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    const nextIndex = endIndex;
    const done = nextIndex >= total;

    await sql`UPDATE scan_source_jobs SET done_cells = ${nextIndex}, updated_at = NOW() WHERE id = ${jobId}`;
    if (done) {
      await markJobDone(jobId, scanId);
    }

    console.log('[amello] done —', processed, 'processed,', failures, 'failures, duration:', Date.now() - tStart, 'ms');

    return NextResponse.json({ processed, failures, nextIndex, done, total });

  } catch (e: any) {
    console.error('[amello] fatal', e);
    return NextResponse.json({ error: 'Amello processing error' }, { status: 500 });
  }
}

