// Shared handler for booking and booking_member source jobs.
// booking        → no cookies, stores standard price only
// booking_member → cookies, stores member (Genius) price as primary price

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import {
  toYMDUTC, normalizeYMD, ymdToUTC, datesFromBase,
} from '@/lib/scrapers/process-helpers';
import { parseHTML } from '@/lib/scrapers/utils/html-parser';
import { getBookingCookies } from '@/app/api/settings/booking-cookies/get';

const SCRAPINGANT_API_KEY = process.env.SCRAPINGANT_API_KEY || '';
const SCRAPINGANT_URL = 'https://api.scrapingant.com/v2/general';
const CONCURRENCY = 3;

// ─── ScrapingAnt fetch ────────────────────────────────────────────────────────

async function fetchWithScrapingAnt(url: string, useCredentials: boolean): Promise<string> {
  if (!SCRAPINGANT_API_KEY) {
    throw new Error('SCRAPINGANT_API_KEY environment variable is not set');
  }

  const params = new URLSearchParams({
    url,
    'x-api-key': SCRAPINGANT_API_KEY,
    browser: 'true',
    wait_for_selector: '#available_rooms',
    proxy_country: 'DE',
  });

  const fetchHeaders: Record<string, string> = { 'Accept': 'text/html' };

  if (useCredentials) {
    const cookies = await getBookingCookies();
    if (cookies) {
      const cookieString = cookies.split(';').map(c => c.trim()).filter(Boolean).join('; ');
      fetchHeaders['ant-Cookie'] = cookieString;
    }
  }

  const response = await fetch(`${SCRAPINGANT_URL}?${params}`, {
    method: 'GET',
    headers: fetchHeaders,
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
    actualPrice: number;   // price you pay (non-strikethrough, always present)
    basePrice?: number;    // strikethrough price (only when a discount is shown)
    currency: string;
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

// Standard price: .js-strikethrough-price (crossed-out original)
// Member price:   .bui-price-display__value (Genius discounted price)
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

    // Collect the scope: the room row itself plus all following rows until the next room
    const nextRows = roomRow.nextAll();
    const nextRoomIdx = nextRows.toArray().findIndex(r => $(r).find('.hprt-roomtype-link').length > 0);
    const scopeRows = [
      roomRow,
      ...(nextRoomIdx >= 0 ? nextRows.slice(0, nextRoomIdx) : nextRows).toArray().map(r => $(r)),
    ];

    // Each row/cell that contains a price element is one rate
    for (const $row of scopeRows) {
      $row.find('.bui-price-display__value').each((_, priceEl) => {
        const $priceEl = $(priceEl);
        // Walk up to find the containing rate cell/row for context
        const $rateContainer = $priceEl.closest('tr, .hprt-table-row, .hprt-table-cell, .bui-list__item');
        const { standard, member } = extractPricesFromCell($, $rateContainer.length ? $rateContainer : $row);
        if (!standard) return;

        // Map cancellation policy text to a rate name
        const cancellationText = $rateContainer.find('.e2e-cancellation, .bui-list__description, [data-testid="cancellation-policy"]').first().text().trim();
        const rateName = cancellationText.includes('Kostenlose Stornierung') ? 'Flexi Rate'
          : cancellationText.includes('Nicht kostenlos stornierbar') ? 'Fixed Rate'
          : cancellationText || null;

        const entry: BookingRoom['rates'][number] = member
          ? { name: rateName, actualPrice: member.amount, basePrice: standard.amount, currency: standard.currency }
          : { name: rateName, actualPrice: standard.amount, currency: standard.currency };
        rates.push(entry);
      });
    }

    // Deduplicate by actualPrice to avoid collecting the same price from nested elements
    const seen = new Set<number>();
    const deduped = rates.filter(r => {
      if (seen.has(r.actualPrice)) return false;
      seen.add(r.actualPrice);
      return true;
    });

    if (deduped.length) rooms.push({ name: roomName, rates: deduped });
  });

  return rooms;
}

// For booking_member: keep all rates; include basePrice only when a Genius strikethrough was found.
function asMemberRooms(rooms: BookingRoom[]): BookingRoom[] {
  return rooms;
}

// ─── Shared handler ───────────────────────────────────────────────────────────

export async function handleBookingJob(
  req: NextRequest,
  source: 'booking' | 'booking_member',
): Promise<NextResponse> {
  const useCredentials = source === 'booking_member';
  const tStart = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const jobId = Number(body?.jobId);
    const startIndex = Number.isFinite(body?.startIndex) ? Number(body.startIndex) : 0;
    const size = Math.max(1, Math.min(100, Number.isFinite(body?.size) ? Number(body.size) : 50));

    if (!Number.isFinite(jobId) || jobId <= 0) {
      return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });
    }

    const jobQ = await sql`
      SELECT j.id, j.scan_id, j.status AS job_status, j.total_cells,
             s.base_checkin::text AS base_checkin, s.days, s.stay_nights, s.status AS scan_status
      FROM scan_source_jobs j
      JOIN scans s ON s.id = j.scan_id
      WHERE j.id = ${jobId} AND j.source = ${source}
    `;

    if (!jobQ.rows.length) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const job = jobQ.rows[0];

    if (job.scan_status === 'cancelled' || job.job_status === 'cancelled') {
      return NextResponse.json({ processed: 0, done: true, message: 'Cancelled' });
    }

    const scanId = job.scan_id as number;

    const baseYMD = normalizeYMD(job.base_checkin);
    const daysNum = Number(job.days);
    const dates: string[] = baseYMD && Number.isFinite(daysNum) && daysNum > 0
      ? datesFromBase(baseYMD, daysNum) : [];

    if (!dates.length) {
      return NextResponse.json({ error: 'No dates to process' }, { status: 400 });
    }

    const hotels = (await sql`
      SELECT sh.hotel_id AS id, h.booking_url
      FROM scan_hotels sh
      JOIN hotels h ON h.id = sh.hotel_id
      WHERE sh.scan_id = ${scanId}
        AND h.booking_url IS NOT NULL AND h.booking_url != ''
      ORDER BY sh.hotel_id ASC
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

        console.log(`[${source}] Scraping hotel ${cell.hotelId} | ${cell.checkIn} → ${cell.checkOut}`);

        let status: 'green' | 'red' | 'error' = 'error';
        let responseJson: any = { rooms: [], source };

        try {
          const html = await fetchWithScrapingAnt(url, useCredentials);
          const rawRooms = parseBookingHTML(html);
          const rooms = useCredentials ? asMemberRooms(rawRooms) : rawRooms;
          status = rooms.length > 0 ? 'green' : 'red';
          responseJson = { rooms, source };
          console.log(`[${source}] Hotel ${cell.hotelId} | ${cell.checkIn}: ${status} (${rooms.length} rooms)`);
        } catch (e: any) {
          console.error(`[${source}] Scrape error hotel ${cell.hotelId}:`, e.message);
          status = 'error';
          responseJson = { error: e.message, rooms: [], source };
        }

        try {
          await sql`
            INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status, response_json, source)
            VALUES (${scanId}, ${cell.hotelId}, ${cell.checkIn}, ${status}, ${JSON.stringify(responseJson)}, ${source})
            ON CONFLICT (scan_id, hotel_id, source, check_in_date)
            DO UPDATE SET status = EXCLUDED.status, response_json = EXCLUDED.response_json
          `;
          processed++;
        } catch (e: any) {
          failures++;
          console.error(`[${source}] DB write error:`, e.message);
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    if (processed > 0) {
      await sql`
        UPDATE scan_source_jobs
        SET done_cells = GREATEST(done_cells, LEAST(${startIndex} + ${processed}, ${total})), updated_at = NOW()
        WHERE id = ${jobId}
      `;
      await sql`
        UPDATE scans SET done_cells = LEAST(done_cells + ${processed}, total_cells) WHERE id = ${scanId}
      `;
    }

    const nextIndex = endIndex;
    const done = nextIndex >= total;

    if (done) await markJobDone(jobId, scanId);

    console.log(`[${source}] done — ${processed} processed, ${failures} failures, ${Date.now() - tStart}ms`);

    return NextResponse.json({ processed, failures, nextIndex, done, total });

  } catch (e: any) {
    console.error(`[${source}] fatal`, e);
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
