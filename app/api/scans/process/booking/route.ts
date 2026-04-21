// app/api/scans/process/booking/route.ts
// Processes one batch of Booking.com scrapes for a given scan_source_job.
// Receives: { jobId, startIndex, size }
// Uses ScrapingAnt API for JS-rendered HTML — no browser needed on Vercel.

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import {
  toYMDUTC, normalizeYMD, ymdToUTC, datesFromBase,
} from '@/lib/scrapers/process-helpers';
import { parseHTML } from '@/lib/scrapers/utils/html-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SCRAPINGANT_API_KEY = process.env.SCRAPINGANT_API_KEY || '';
const SCRAPINGANT_URL = 'https://api.scrapingant.com/v2/general';
const BOOKING_COM_COOKIES = process.env.BOOKING_COM_COOKIES || '';
const CONCURRENCY = 3;

// ─── ScrapingAnt fetch ────────────────────────────────────────────────────────

async function fetchWithScrapingAnt(url: string): Promise<string> {
  if (!SCRAPINGANT_API_KEY) {
    throw new Error('SCRAPINGANT_API_KEY environment variable is not set');
  }

  const params: Record<string, string> = {
    url,
    'x-api-key': SCRAPINGANT_API_KEY,
    browser: 'true',
    wait_for_selector: '#available_rooms',
    proxy_country: 'DE',
  };

  if (BOOKING_COM_COOKIES) {
    params['cookies'] = BOOKING_COM_COOKIES;
  }

  const response = await fetch(`${SCRAPINGANT_URL}?${new URLSearchParams(params)}`, {
    method: 'GET',
    headers: { 'Accept': 'text/html' },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`ScrapingAnt error ${response.status}: ${body.slice(0, 200)}`);
  }

  return response.text();
}

// ─── HTML parsing ─────────────────────────────────────────────────────────────

interface BookingRoom {
  name: string;
  rates: Array<{
    name: string | null;
    price: number;
    currency: string;
    memberPrice?: number; // Genius / logged-in member price, if different from standard
  }>;
}

const DEFAULT_CURRENCY = 'EUR';

function parsePriceText(priceText: string): { amount: number; currency: string } | null {
  if (!priceText) return null;

  let currency = DEFAULT_CURRENCY;
  if (priceText.includes('€')) currency = 'EUR';
  else if (priceText.includes('$')) currency = 'USD';
  else if (priceText.includes('£')) currency = 'GBP';
  else {
    const cm = priceText.match(/\b([A-Z]{3})\b/);
    if (cm) currency = cm[1];
  }

  let n = priceText
    .replace(/[€$£]/g, '')
    .replace(/\b[A-Z]{3}\b/g, '')
    .replace(/[^\d.,]/g, '')
    .trim();

  if (n.includes(',') && n.includes('.')) {
    n = n.lastIndexOf('.') > n.lastIndexOf(',')
      ? n.replace(/,/g, '').replace('.', '')
      : n.replace(/\./g, '').replace(',', '');
  } else if (n.includes(',')) {
    const parts = n.split(',');
    n = parts.length === 2 && parts[1].length <= 2 ? n.replace(',', '') : n.replace(/,/g, '');
  } else if (n.includes('.')) {
    const parts = n.split('.');
    n = parts.length === 2 && parts[1].length <= 2 ? n.replace('.', '') : n.replace(/\./g, '');
  }

  const amount = parseInt(n, 10);
  if (isNaN(amount) || amount <= 0) return null;
  return { amount, currency };
}

// Standard price: element with class js-strikethrough-price (crossed-out original).
// Member price:   element with class bui-price-display__value (the discounted Genius price).
function extractPricesFromCell($: ReturnType<typeof parseHTML>, cell: any): {
  standard: { amount: number; currency: string } | null;
  member: { amount: number; currency: string } | null;
} {
  const $cell = $(cell);

  const standardEl = $cell.find('.js-strikethrough-price').first();
  const standardParsed = standardEl.length ? parsePriceText(standardEl.text().trim()) : null;

  const memberEl = $cell.find('.bui-price-display__value').first();
  const memberParsed = memberEl.length ? parsePriceText(memberEl.text().trim()) : null;

  if (standardParsed && memberParsed) {
    return { standard: standardParsed, member: memberParsed };
  }

  // No strikethrough — only one price present, treat as standard only
  return { standard: memberParsed, member: null };
}

function parseBookingHTML(html: string): BookingRoom[] {
  const $ = parseHTML(html);
  const rooms: BookingRoom[] = [];

  const container = $('#available_rooms');
  if (!container.length) {
    console.warn('[booking] #available_rooms not found in HTML');
    return rooms;
  }

  const roomElements = container.find('.hprt-roomtype-link');

  roomElements.each((_, el) => {
    const roomName = $(el).text().trim();
    if (!roomName) return;

    const roomRow = $(el).closest('tr, .hprt-table-row');
    const rates: BookingRoom['rates'] = [];

    let rateEls = roomRow.find('.bui-list__item.e2e-cancellation');

    if (!rateEls.length) {
      const nextRows = roomRow.nextAll();
      const nextRoomIdx = nextRows.toArray().findIndex(r => $(r).find('.hprt-roomtype-link').length > 0);
      const scope = nextRoomIdx >= 0 ? nextRows.slice(0, nextRoomIdx) : nextRows;
      rateEls = scope.find('.bui-list__item.e2e-cancellation');
    }

    rateEls.each((_, rateEl) => {
      const rateName = $(rateEl).text().trim() || null;
      let priceCell = $(rateEl).find('.bui-price-display__value').length
        ? $(rateEl)
        : $(rateEl).closest('tr, .hprt-table-row, .hprt-table-cell');
      const { standard, member } = extractPricesFromCell($, priceCell);
      if (!standard) return;
      const entry: BookingRoom['rates'][number] = {
        name: rateName,
        price: standard.amount,
        currency: standard.currency,
      };
      if (member) entry.memberPrice = member.amount;
      rates.push(entry);
    });

    if (!rates.length) {
      // Fallback: grab prices directly from the row
      const { standard, member } = extractPricesFromCell($, roomRow);
      if (standard) {
        const entry: BookingRoom['rates'][number] = {
          name: null,
          price: standard.amount,
          currency: standard.currency,
        };
        if (member) entry.memberPrice = member.amount;
        rates.push(entry);
      }
    }

    if (rates.length) rooms.push({ name: roomName, rates });
  });

  return rooms;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const tStart = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const jobId = Number(body?.jobId);
    const startIndex = Number.isFinite(body?.startIndex) ? Number(body.startIndex) : 0;
    const size = Math.max(1, Math.min(100, Number.isFinite(body?.size) ? Number(body.size) : 50));

    if (!Number.isFinite(jobId) || jobId <= 0) {
      return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });
    }

    // Load source job + parent scan
    const jobQ = await sql`
      SELECT j.id, j.scan_id, j.status AS job_status, j.total_cells,
             s.base_checkin::text AS base_checkin, s.days, s.stay_nights, s.status AS scan_status
      FROM scan_source_jobs j
      JOIN scans s ON s.id = j.scan_id
      WHERE j.id = ${jobId} AND j.source = 'booking'
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
      SELECT id, booking_url FROM hotels
      WHERE active = true AND bookable = true AND booking_url IS NOT NULL AND booking_url != ''
      ORDER BY id ASC
    `).rows as Array<{ id: number; booking_url: string }>;

    if (!hotels.length) {
      await markJobDone(jobId, scanId);
      return NextResponse.json({ processed: 0, done: true, total: 0, message: 'No hotels with booking_url' });
    }

    const total = hotels.length * dates.length;
    const clampedStart = Math.max(0, Math.min(startIndex, total));
    const endIndex = Math.min(total, clampedStart + size);

    if (clampedStart >= endIndex) {
      await markJobDone(jobId, scanId);
      return NextResponse.json({ processed: 0, nextIndex: total, done: true, total });
    }

    const stayNights = Number(job.stay_nights) || 7;
    const slice: Array<{ hotelId: number; bookingUrl: string; checkIn: string; checkOut: string }> = [];

    for (let idx = clampedStart; idx < endIndex; idx++) {
      const h = hotels[Math.floor(idx / dates.length)];
      const checkIn = dates[idx % dates.length];
      const checkInDt = ymdToUTC(checkIn);
      checkInDt.setUTCDate(checkInDt.getUTCDate() + stayNights);
      slice.push({ hotelId: h.id, bookingUrl: h.booking_url, checkIn, checkOut: toYMDUTC(checkInDt) });
    }

    let i = 0;
    let processed = 0;
    let failures = 0;

    async function worker() {
      while (true) {
        const idx = i++;
        if (idx >= slice.length) break;
        const cell = slice[idx];

        const url = (() => {
          const u = new URL(cell.bookingUrl);
          u.searchParams.set('checkin', cell.checkIn);
          u.searchParams.set('checkout', cell.checkOut);
          u.searchParams.set('group_adults', '2');
          u.searchParams.set('group_children', '0');
          return u.toString();
        })();

        console.log(`[booking] Scraping hotel ${cell.hotelId} | ${cell.checkIn} → ${cell.checkOut}`);

        let status: 'green' | 'red' | 'error' = 'error';
        let responseJson: any = { rooms: [], source: 'booking' };

        try {
          const html = await fetchWithScrapingAnt(url);
          const rooms = parseBookingHTML(html);
          status = rooms.length > 0 ? 'green' : 'red';
          responseJson = { rooms, source: 'booking' };
          console.log(`[booking] Hotel ${cell.hotelId} | ${cell.checkIn}: ${status} (${rooms.length} rooms)`);
        } catch (e: any) {
          console.error(`[booking] Scrape error hotel ${cell.hotelId}:`, e.message);
          status = 'error';
          responseJson = { error: e.message, rooms: [], source: 'booking' };
        }

        try {
          await sql`
            INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status, response_json, source)
            VALUES (${scanId}, ${cell.hotelId}, ${cell.checkIn}, ${status}, ${JSON.stringify(responseJson)}, 'booking')
            ON CONFLICT (scan_id, hotel_id, source, check_in_date)
            DO UPDATE SET status = EXCLUDED.status, response_json = EXCLUDED.response_json
          `;
          processed++;
        } catch (e: any) {
          failures++;
          console.error('[booking] DB write error:', e.message);
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    // Update source job progress
    if (processed > 0) {
      await sql`
        UPDATE scan_source_jobs
        SET done_cells = LEAST(done_cells + ${processed}, ${total}), updated_at = NOW()
        WHERE id = ${jobId}
      `;
      await sql`
        UPDATE scans SET done_cells = LEAST(done_cells + ${processed}, total_cells) WHERE id = ${scanId}
      `;
    }

    const nextIndex = endIndex;
    const done = nextIndex >= total;

    if (done) {
      await markJobDone(jobId, scanId);
    }

    console.log('[booking] done —', processed, 'processed,', failures, 'failures, duration:', Date.now() - tStart, 'ms');

    return NextResponse.json({ processed, failures, nextIndex, done, total });

  } catch (e: any) {
    console.error('[booking] fatal', e);
    return NextResponse.json({ error: 'Booking processing error' }, { status: 500 });
  }
}

async function markJobDone(jobId: number, scanId: number) {
  await sql`UPDATE scan_source_jobs SET status = 'done', updated_at = NOW() WHERE id = ${jobId}`;
  await checkAndFinalizeScan(scanId);
}

async function checkAndFinalizeScan(scanId: number) {
  const pending = await sql`
    SELECT COUNT(*)::int AS c FROM scan_source_jobs
    WHERE scan_id = ${scanId} AND status IN ('running','queued')
  `;
  if ((pending.rows[0]?.c ?? 1) === 0) {
    await sql`UPDATE scans SET status = 'done' WHERE id = ${scanId} AND status != 'cancelled'`;
    console.log(`[booking] Scan #${scanId} finalized — all source jobs complete`);

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
  }
}
