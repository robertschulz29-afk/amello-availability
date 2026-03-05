// app/api/scans/process/amello/route.ts
// Processes Amello API scans for a given batch of hotel × date cells.
// Called by the orchestrator at /api/scans/process

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { extractRoomRateData } from '@/lib/price-utils';
import { DEFAULT_BELLO_MANDATOR } from '@/lib/constants';
import {
  toYMDUTC, normalizeYMD, ymdToUTC, datesFromBase, type ScanCell,
} from '@/lib/scrapers/process-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BASE_URL = process.env.AMELLO_BASE_URL || 'https://prod-api.amello.plusline.net/api/v1';
const CONCURRENCY = 4;

export async function POST(req: NextRequest) {
  const tStart = Date.now();
  console.log('[amello] ===== AMELLO PROCESS START =====', new Date().toISOString());

  const belloMandator = req.headers.get('Bello-Mandator') || DEFAULT_BELLO_MANDATOR;

  try {
    const body = await req.json().catch(() => ({}));
    const scanId = Number(body?.scanId);
    const startIndex = Number.isFinite(body?.startIndex) ? Number(body.startIndex) : 0;
    const size = Math.max(1, Math.min(200, Number.isFinite(body?.size) ? Number(body.size) : 50));

    if (!Number.isFinite(scanId) || scanId <= 0) {
      return NextResponse.json({ error: 'Invalid scanId' }, { status: 400 });
    }

    // Load scan
    const s = await sql`
      SELECT id, base_checkin::text AS base_checkin, days, stay_nights, start_offset, end_offset, total_cells, status
      FROM scans WHERE id = ${scanId}
    `;
    if (!s.rows.length) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
    const scan = s.rows[0];

    if (scan.status === 'cancelled') {
      return NextResponse.json({ processed: 0, done: true, message: 'Scan cancelled' });
    }

    // Build dates
    const baseYMD = normalizeYMD(scan.base_checkin);
    const daysNum = Number(scan.days);
    let dates: string[] = [];

    if (baseYMD && Number.isFinite(daysNum) && daysNum > 0) {
      dates = datesFromBase(baseYMD, daysNum);
    }

    if (!dates.length) {
      return NextResponse.json({ error: 'No dates to process' }, { status: 400 });
    }

    // Hotels
    const hotels = (await sql`
      SELECT id, code FROM hotels WHERE active = true AND bookable = true ORDER BY id ASC
    `).rows as Array<{ id: number; code: string }>;

    if (!hotels.length) {
      return NextResponse.json({ error: 'No hotels to process' }, { status: 400 });
    }

    const total = hotels.length * dates.length;
    const clampedStart = Math.max(0, Math.min(startIndex, total));
    const endIndex = Math.min(total, clampedStart + size);

    if (clampedStart >= endIndex) {
      return NextResponse.json({ processed: 0, nextIndex: total, done: true, total });
    }

    // Build slice
    const stayNights = Number(scan.stay_nights) || 7;
    const slice: ScanCell[] = [];

    for (let idx = clampedStart; idx < endIndex; idx++) {
      const hotelIdx = Math.floor(idx / dates.length);
      const dateIdx = idx % dates.length;
      const h = hotels[hotelIdx];
      const checkIn = dates[dateIdx];
      const checkInDt = ymdToUTC(checkIn);
      checkInDt.setUTCDate(checkInDt.getUTCDate() + stayNights);
      slice.push({ hotelId: h.id, hotelCode: h.code, bookingUrl: null, checkIn, checkOut: toYMDUTC(checkInDt) });
    }

    // Process concurrently
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
            roomConfigurations: [{ travellers: { id: 1, adultCount: 2, childrenAges: [] } }],
            locale: 'de_DE',
          };

          const res = await fetch(`${BASE_URL}/hotel/offer`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Bello-Mandator': belloMandator,
            },
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

    // Update done_cells
    if (processed > 0) {
      await sql`
        UPDATE scans SET done_cells = LEAST(done_cells + ${processed}, ${total}) WHERE id = ${scanId}
      `;
    }

    const nextIndex = endIndex;
    const done = nextIndex >= total;

    if (done) {
      // Mark done only if booking is also done — orchestrator handles final status
      // Just return done=true and let orchestrator decide
    }

    console.log('[amello] done —', processed, 'processed,', failures, 'failures, duration:', Date.now() - tStart, 'ms');

    return NextResponse.json({ processed, failures, nextIndex, done, total });

  } catch (e: any) {
    console.error('[amello] fatal', e);
    return NextResponse.json({ error: 'Amello processing error' }, { status: 500 });
  }
}
