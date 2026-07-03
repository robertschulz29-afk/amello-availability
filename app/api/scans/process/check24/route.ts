// app/api/scans/process/check24/route.ts
// Processes one batch of Check24 Playwright scrapes for a given scan_source_job.
// Receives: { jobId, startIndex, size }
//
// Unlike amello/booking (cell-level Promise.all concurrency against a plain
// HTTP API / ScrapingAnt), Check24 needs a real browser per hotel: we launch
// one browser context per hotel, process up to 2 pages concurrently within
// that hotel, then close the context before moving to the next hotel.

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import {
  toYMDUTC, normalizeYMD, ymdToUTC, datesFromBase, markJobDone,
} from '@/lib/scrapers/process-helpers';
import { launchCheck24Browser, scrapeCheck24Cell } from '@/lib/scrapers/check24-scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Check24 batches are much more expensive (real browser per hotel), so cap
// them well below the default SCAN_BATCH_SIZE (50) used by amello/booking.
const CHECK24_BATCH_SIZE = 12;
const HOTEL_PAGE_CONCURRENCY = 2;

type Check24Cell = { hotelId: number; check24Url: string; checkIn: string; checkOut: string };

export async function POST(req: NextRequest) {
  // Authenticate server-to-server cron calls via CRON_SECRET bearer token
  // (this route is bypassed by middleware's session check — see middleware.ts).
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tStart = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const jobId = Number(body?.jobId);
    const startIndex = Number.isFinite(body?.startIndex) ? Number(body.startIndex) : 0;
    const size = Math.max(1, Math.min(CHECK24_BATCH_SIZE, Number.isFinite(body?.size) ? Number(body.size) : CHECK24_BATCH_SIZE));

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
      WHERE j.id = ${jobId} AND j.source = 'check24'
    `;

    if (!jobQ.rows.length) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const job = jobQ.rows[0];

    if (job.scan_status === 'cancelled' || job.job_status === 'cancelled') {
      return NextResponse.json({ processed: 0, done: true, message: 'Cancelled' });
    }

    const scanId = job.scan_id as number;
    const adultCount = Math.max(1, Number(job.adult_count) || 2);

    // Build date list
    const baseYMD = normalizeYMD(job.base_checkin);
    const daysNum = Number(job.days);
    const dates: string[] = baseYMD && Number.isFinite(daysNum) && daysNum > 0
      ? datesFromBase(baseYMD, daysNum) : [];

    if (!dates.length) {
      return NextResponse.json({ error: 'No dates to process' }, { status: 400 });
    }

    const hotels = (await sql`
      SELECT sh.hotel_id AS id, h.check24_url
      FROM scan_hotels sh
      JOIN hotels h ON h.id = sh.hotel_id
      WHERE sh.scan_id = ${scanId}
        AND h.check24_url IS NOT NULL AND h.check24_url != ''
      ORDER BY sh.hotel_id ASC
    `).rows as Array<{ id: number; check24_url: string }>;

    if (!hotels.length) {
      await sql`UPDATE scan_source_jobs SET done_cells = 0, updated_at = NOW() WHERE id = ${jobId}`;
      await markJobDone(jobId, scanId);
      return NextResponse.json({ processed: 0, done: true, total: 0, message: 'No hotels with check24_url' });
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
    const slice: Check24Cell[] = [];

    for (let idx = clampedStart; idx < endIndex; idx++) {
      const h = hotels[Math.floor(idx / dates.length)];
      const checkIn = dates[idx % dates.length];
      const checkInDt = ymdToUTC(checkIn);
      checkInDt.setUTCDate(checkInDt.getUTCDate() + stayNights);
      slice.push({ hotelId: h.id, check24Url: h.check24_url, checkIn, checkOut: toYMDUTC(checkInDt) });
    }

    // Group cells by hotel so we can launch one browser per hotel
    const cellsByHotel = new Map<number, Check24Cell[]>();
    for (const cell of slice) {
      const arr = cellsByHotel.get(cell.hotelId) ?? [];
      arr.push(cell);
      cellsByHotel.set(cell.hotelId, arr);
    }

    let processed = 0;
    let failures = 0;

    for (const [hotelId, cells] of cellsByHotel) {
      let browser: any = null;
      try {
        browser = await launchCheck24Browser();
        const context = await browser.newContext();

        let i = 0;
        async function worker() {
          while (true) {
            const idx = i++;
            if (idx >= cells.length) break;
            const cell = cells[idx];

            const { status, responseJson } = await scrapeCheck24Cell(
              context, cell.check24Url, cell.checkIn, cell.checkOut, adultCount,
            );

            try {
              await sql`
                INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status, response_json, source)
                VALUES (${scanId}, ${cell.hotelId}, ${cell.checkIn}, ${status}, ${JSON.stringify(responseJson)}, 'check24')
                ON CONFLICT (scan_id, hotel_id, source, check_in_date)
                DO UPDATE SET status = EXCLUDED.status, response_json = EXCLUDED.response_json
              `;
              processed++;
            } catch (e: any) {
              failures++;
              console.error('[check24] DB write error', e.message);
            }
          }
        }

        await Promise.all(Array.from({ length: HOTEL_PAGE_CONCURRENCY }, () => worker()));
        await context.close().catch(() => {});
      } catch (e: any) {
        console.error('[check24] browser error for hotel', hotelId, e.message);
        // Mark all cells for this hotel as error so the batch keeps moving
        for (const cell of cells) {
          try {
            await sql`
              INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status, response_json, source)
              VALUES (${scanId}, ${cell.hotelId}, ${cell.checkIn}, 'error', ${JSON.stringify({ rooms: [], source: 'check24', error: e.message })}, 'check24')
              ON CONFLICT (scan_id, hotel_id, source, check_in_date)
              DO UPDATE SET status = EXCLUDED.status, response_json = EXCLUDED.response_json
            `;
            processed++;
          } catch (dbErr: any) {
            failures++;
            console.error('[check24] DB write error', dbErr.message);
          }
        }
      } finally {
        if (browser) await browser.close().catch(() => {});
      }
    }

    const nextIndex = endIndex;
    const done = nextIndex >= total;

    await sql`UPDATE scan_source_jobs SET done_cells = ${nextIndex}, updated_at = NOW() WHERE id = ${jobId}`;
    if (done) {
      await markJobDone(jobId, scanId);
    }

    console.log('[check24] done —', processed, 'processed,', failures, 'failures, duration:', Date.now() - tStart, 'ms');

    return NextResponse.json({ processed, failures, nextIndex, done, total });

  } catch (e: any) {
    console.error('[check24] fatal', e);
    return NextResponse.json({ error: 'Check24 processing error' }, { status: 500 });
  }
}
