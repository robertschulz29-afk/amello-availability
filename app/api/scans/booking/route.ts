// app/api/scans/process/booking/route.ts
// Processes Booking.com scrapes for a given batch of hotel × date cells.
// Uses ScrapingAnt API instead of local Puppeteer — no browser needed on Vercel.
// Called by the orchestrator at /api/scans/process

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import {
  toYMDUTC, normalizeYMD, ymdToUTC, datesFromBase, type ScanCell,
} from '@/lib/scrapers/process-helpers';
import { parseHTML } from '@/lib/scrapers/utils/html-parser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// ScrapingAnt renders the page in a real browser on their infrastructure,
// bypasses bot detection, and returns fully rendered HTML.
// Sign up at https://scrapingant.com — free tier: 10,000 credits (1 credit per JS-rendered page)
const SCRAPINGANT_API_KEY = process.env.SCRAPINGANT_API_KEY || '';
const SCRAPINGANT_URL = 'https://api.scrapingant.com/v2/general';

const CONCURRENCY = 3; // Keep low — each ScrapingAnt request uses 1 credit + their concurrency limits

// ─── ScrapingAnt fetch ────────────────────────────────────────────────────────

async function fetchWithScrapingAnt(url: string): Promise<string> {
  if (!SCRAPINGANT_API_KEY) {
    throw new Error('SCRAPINGANT_API_KEY environment variable is not set');
  }

  const params = new URLSearchParams({
    url,
    'x-api-key': SCRAPINGANT_API_KEY,
    browser: 'true',        // JS rendering
    wait_for_selector: '#available_rooms', // Wait until room table is in DOM
  });

  const response = await fetch(`${SCRAPINGANT_URL}?${params}`, {
    method: 'GET',
    headers: { 'Accept': 'text/html' },
    // ScrapingAnt handles its own timeouts internally (~30s)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`ScrapingAnt error ${response.status}: ${body.slice(0, 200)}`);
  }

  return response.text();
}

// ─── HTML parsing (same logic as BookingComScraper) ──────────────────────────

interface BookingRoom {
  name: string;
  rates: Array<{ name: string | null; price: number; currency: string }>;
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
    n = parts.length === 2 && parts[1].length <= 2
      ? n.replace(',', '')
      : n.replace(/,/g, '');
  } else if (n.includes('.')) {
    const parts = n.split('.');
    n = parts.length === 2 && parts[1].length <= 2
      ? n.replace('.', '')
      : n.replace(/\./g, '');
  }

  const amount = parseInt(n, 10);
  if (isNaN(amount) || amount <= 0) return null;
  return { amount, currency };
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
  console.log('[booking] Room elements found:', roomElements.length);

  roomElements.each((_, el) => {
    const roomName = $(el).text().trim();
    if (!roomName) return;

    const roomRow = $(el).closest('tr, .hprt-table-row');
    const rates: BookingRoom['rates'] = [];

    // Try rates in same row first
    let rateEls = roomRow.find('.bui-list__item.e2e-cancellation');

    // Fall back to sibling rows before next room
    if (!rateEls.length) {
      const nextRows = roomRow.nextAll();
      const nextRoomIdx = nextRows.toArray().findIndex(r => $(r).find('.hprt-roomtype-link').length > 0);
      const scope = nextRoomIdx >= 0 ? nextRows.slice(0, nextRoomIdx) : nextRows;
      rateEls = scope.find('.bui-list__item.e2e-cancellation');
    }

    rateEls.each((_, rateEl) => {
      const rateName = $(rateEl).text().trim() || null;
      let priceEl = $(rateEl).find('.bui-price-display__value').first();
      if (!priceEl.length) {
        priceEl = $(rateEl).closest('tr, .hprt-table-row, .hprt-table-cell').find('.bui-price-display__value').first();
      }
      if (!priceEl.length) return;
      const parsed = parsePriceText($(priceEl).text().trim());
      if (parsed) rates.push({ name: rateName, price: parsed.amount, currency: parsed.currency });
    });

    // Direct price fallback
    if (!rates.length) {
      roomRow.find('.bui-price-display__value').each((_, priceEl) => {
        const parsed = parsePriceText($(priceEl).text().trim());
        if (parsed) rates.push({ name: null, price: parsed.amount, currency: parsed.currency });
      });
    }

    if (rates.length) rooms.push({ name: roomName, rates });
  });

  return rooms;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const tStart = Date.now();
  console.log('[booking] ===== BOOKING PROCESS START =====', new Date().toISOString());

  try {
    const body = await req.json().catch(() => ({}));
    const scanId = Number(body?.scanId);
    const startIndex = Number.isFinite(body?.startIndex) ? Number(body.startIndex) : 0;
    const size = Math.max(1, Math.min(100, Number.isFinite(body?.size) ? Number(body.size) : 50));

    if (!Number.isFinite(scanId) || scanId <= 0) {
      return NextResponse.json({ error: 'Invalid scanId' }, { status: 400 });
    }

    // Load scan
    const s = await sql`
      SELECT id, base_checkin::text AS base_checkin, days, stay_nights, status
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

    // Only hotels with a booking_url
    const hotels = (await sql`
      SELECT id, booking_url FROM hotels
      WHERE active = true AND bookable = true AND booking_url IS NOT NULL AND booking_url != ''
      ORDER BY id ASC
    `).rows as Array<{ id: number; booking_url: string }>;

    if (!hotels.length) {
      return NextResponse.json({ processed: 0, done: true, total: 0, message: 'No hotels with booking_url' });
    }

    const total = hotels.length * dates.length;
    const clampedStart = Math.max(0, Math.min(startIndex, total));
    const endIndex = Math.min(total, clampedStart + size);

    if (clampedStart >= endIndex) {
      return NextResponse.json({ processed: 0, nextIndex: total, done: true, total });
    }

    // Build slice
    const stayNights = Number(scan.stay_nights) || 7;
    const slice: Array<{ hotelId: number; bookingUrl: string; checkIn: string; checkOut: string }> = [];

    for (let idx = clampedStart; idx < endIndex; idx++) {
      const hotelIdx = Math.floor(idx / dates.length);
      const dateIdx = idx % dates.length;
      const h = hotels[hotelIdx];
      const checkIn = dates[dateIdx];
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

    const nextIndex = endIndex;
    const done = nextIndex >= total;

    console.log('[booking] done —', processed, 'processed,', failures, 'failures, duration:', Date.now() - tStart, 'ms');

    return NextResponse.json({ processed, failures, nextIndex, done, total });

  } catch (e: any) {
    console.error('[booking] fatal', e);
    return NextResponse.json({ error: 'Booking processing error' }, { status: 500 });
  }
}
