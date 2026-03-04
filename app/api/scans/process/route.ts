import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { extractRoomRateData } from '@/lib/price-utils';
import { DEFAULT_BELLO_MANDATOR } from '@/lib/constants';
import { BookingComScraper } from '@/lib/scrapers/BookingComScraper';
import type { ScanSource } from '@/lib/scrapers/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;



const BASE_URL = process.env.AMELLO_BASE_URL || 'https://prod-api.amello.plusline.net/api/v1';

/* ---------- date helpers (robust) ---------- */
function toYMDUTC(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function normalizeYMD(input: any): string | null {
  if (!input && input !== 0) return null;

  // If already a Date
  if (input instanceof Date && !isNaN(input.getTime())) {
    return toYMDUTC(input);
  }

  // Strings: accept 'YYYY-MM-DD' or ISO like 'YYYY-MM-DDTHH:mm:ssZ'
  const s = String(input);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // Try Date parsing as last resort
  const d = new Date(s);
  if (!isNaN(d.getTime())) return toYMDUTC(d);

  return null;
}
function ymdToUTC(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function datesFromBase(baseYMD: string, days: number): string[] {
  const base = ymdToUTC(baseYMD);
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const dt = new Date(base);
    dt.setUTCDate(dt.getUTCDate() + i);
    out.push(toYMDUTC(dt));
  }
  return out;
}
function hasNonEmptyRooms(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if (Array.isArray(obj.rooms) && obj.rooms.length > 0) return true;
  if (obj.data && Array.isArray(obj.data.rooms) && obj.data.rooms.length > 0) return true;
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === 'rooms' && Array.isArray(v) && v.length > 0) return true;
  }
  return false;
}

/* ---------- handler ---------- */
export async function POST(req: NextRequest) {
  console.log('[process] ==================== PROCESSING REQUEST ====================');
  console.log('[process] Timestamp:', new Date().toISOString());
  
  const tStart = Date.now();
  const SOFT_BUDGET_MS = 40_000;

  const belloMandator = req.headers.get('Bello-Mandator') || DEFAULT_BELLO_MANDATOR;

  try {
    const body = await req.json().catch(() => ({}));
    const scanId = Number(body?.scanId);
    let startIndex = Number.isFinite(body?.startIndex) ? Number(body.startIndex) : 0;
    const size = Math.max(1, Math.min(200, Number.isFinite(body?.size) ? Number(body.size) : 50));
    
    console.log('[process] ===== PROCESSING PARAMETERS =====');
    console.log('[process] Scan ID:', scanId);
    console.log('[process] Start Index:', startIndex);
    console.log('[process] Batch Size:', size);

    if (!Number.isFinite(scanId) || scanId <= 0) {
      console.error('[process] ❌ Invalid scanId:', scanId);
      return NextResponse.json({ error: 'Invalid scanId' }, { status: 400 });
    }

    // Load scan parameters
    const s = await sql`
      SELECT id, base_checkin::text as base_checkin, days, stay_nights, start_offset, end_offset, total_cells, done_cells, status
      FROM scans WHERE id = ${scanId}
    `;
    if (s.rows.length === 0) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
    const scan = s.rows[0];

    // Debug: log raw base_checkin from DB
    console.log('[process] ===== BASE_CHECKIN DEBUG =====');
    console.log('[process] base_checkin raw value:', scan.base_checkin);
    console.log('[process] base_checkin type:', typeof scan.base_checkin);
    console.log('[process] base_checkin instanceof Date:', scan.base_checkin instanceof Date);
    console.log('[process] base_checkin toString:', String(scan.base_checkin));

    // Check if scan has been cancelled
    if (scan.status === 'cancelled') {
      return NextResponse.json({
        processed: 0,
        nextIndex: startIndex,
        done: true,
        message: 'Scan has been cancelled',
      });
    }

    // Build dates (prefer base_checkin/days, else legacy offsets)
    let dates: string[] = [];

    const baseYMD = normalizeYMD((scan as any).base_checkin);
    const daysNum = Number((scan as any).days);

    console.log('[process] ===== DATES DEBUG =====');
    console.log('[process] baseYMD (after normalizeYMD):', baseYMD);
    console.log('[process] daysNum:', daysNum);

    if (baseYMD && Number.isFinite(daysNum) && daysNum > 0) {
      dates = datesFromBase(baseYMD, daysNum);
    } else {
      // Legacy fallback using offsets relative to "today in Berlin"
      const berlinToday = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());
      const base = ymdToUTC(berlinToday);

      const startOff = Number((scan as any).start_offset);
      const endOff   = Number((scan as any).end_offset);

      if (Number.isFinite(startOff) && Number.isFinite(endOff) && endOff >= startOff) {
        for (let off = startOff; off <= endOff; off++) {
          const dt = new Date(base);
          dt.setUTCDate(dt.getUTCDate() + off);
          dates.push(toYMDUTC(dt));
        }
      }
    }

    console.log('[process] dates[0]:', dates[0]);
    console.log('[process] dates[1]:', dates[1]);
    console.log('[process] dates length:', dates.length);

    // Hotels
    const hotels = (await sql`SELECT id, code, booking_url FROM hotels WHERE active = true AND bookable = true ORDER BY id ASC`).rows as Array<{ id:number; code:string; booking_url:string|null }>;

    // Guard: nothing to do
    if (!hotels.length) {
      await sql`UPDATE scans SET status='error' WHERE id=${scanId}`;
      return NextResponse.json({ error: 'No hotels to process' }, { status: 400 });
    }
    if (!dates.length) {
      await sql`UPDATE scans SET status='error' WHERE id=${scanId}`;
      return NextResponse.json({ error: 'No dates to process (base_checkin/days invalid?)' }, { status: 400 });
    }

    const total = hotels.length * dates.length;

    // Clamp
    startIndex = Math.max(0, Math.min(startIndex, total));
    const endIndex = Math.min(total, startIndex + size);

    if (startIndex >= endIndex) {
      const cur = (await sql`SELECT done_cells FROM scans WHERE id=${scanId}`).rows[0]?.done_cells ?? 0;
      if (cur < total) await sql`UPDATE scans SET done_cells = ${total}, status = 'done' WHERE id = ${scanId}`;
      return NextResponse.json({ processed: 0, nextIndex: total, done: true, total });
    }

    // Build slice
    const stayNights = Number((scan as any).stay_nights) || 7;
    const slice: { hotelId:number; hotelCode:string; bookingUrl:string|null; checkIn:string; checkOut:string }[] = [];
    for (let idx = startIndex; idx < endIndex; idx++) {
      const hotelIdx = Math.floor(idx / dates.length);
      const dateIdx  = idx % dates.length;
      const h = hotels[hotelIdx];

      const checkIn = dates[dateIdx];
      const checkInDt = ymdToUTC(checkIn);
      checkInDt.setUTCDate(checkInDt.getUTCDate() + stayNights);
      const checkOut = toYMDUTC(checkInDt);

      slice.push({ hotelId: h.id, hotelCode: h.code, bookingUrl: h.booking_url, checkIn, checkOut });
    }

    // Debug: log first 3 slice items
    console.log('[process] ===== SLICE DEBUG =====');
    console.log('[process] first 3 slice items:', slice.slice(0, 3).map(s => ({
      hotelId: s.hotelId,
      checkIn: s.checkIn,
      checkOut: s.checkOut,
    })));

    const CONCURRENCY = 4;
    let i = 0;
    let processed = 0;
    let failures  = 0;
    let bookingProcessed = 0;
    let bookingFailures = 0;
    let stopEarly = false;

    const bookingPromises: Promise<void>[] = [];
    const bookingPromisesMeta: Array<{ hotelId: number; checkIn: string; checkOut: string }> = [];

    let bookingScraper: BookingComScraper | null = null;
    const BOOKING_INTERNAL_SOURCE_ID = -1;
    
    const hasRoomsProperty = (data: any): data is { rooms: Array<any> } => {
      return data && typeof data === 'object' && Array.isArray(data.rooms);
    };
    
    const initBookingScraper = () => {
      if (!bookingScraper) {
        const bookingSource: ScanSource = {
          id: BOOKING_INTERNAL_SOURCE_ID,
          name: 'Booking.com',
          enabled: true,
          base_url: 'https://www.booking.com',
          css_selectors: null,
          rate_limit_ms: 2000,
          user_agent_rotation: true,
          created_at: new Date(),
          updated_at: new Date(),
        };
        bookingScraper = new BookingComScraper(bookingSource);
      }
      return bookingScraper;
    };

    async function worker() {
      while (true) {
        if (Date.now() - tStart > SOFT_BUDGET_MS) { stopEarly = true; break; }
        const idx = i++;
        if (idx >= slice.length) break;
        const cell = slice[idx];

        // ============ TUIAmello Scan ============
        let status: 'green' | 'red' = 'red';
        let responseJson: any = null;

        try {
          const payload = {
            hotelId: cell.hotelCode,
            departureDate: cell.checkIn,
            returnDate: cell.checkOut,
            currency: 'EUR',
            roomConfigurations: [
              { travellers: { id: 1, adultCount: 2, childrenAges: [] } },
            ],
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

          if (res.status === 200) {
            const ctype = res.headers.get('content-type') || '';
            if (ctype.includes('application/json')) {
              const j = await res.json();
              const compactData = extractRoomRateData(j);
              responseJson = { ...compactData, source: 'amello' };
              status = (compactData.rooms && compactData.rooms.length > 0) ? 'green' : 'red';
            } else {
              status = 'red';
              responseJson = { httpStatus: res.status, text: await res.text().catch(()=>null), source: 'amello' };
            }
          } else {
            status = 'red';
            responseJson = { httpStatus: res.status, text: await res.text().catch(()=>null), source: 'amello' };
          }
        } catch (e:any) {
          console.error('[process] upstream fetch error', e, cell);
          status = 'red';
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
        } catch (e) {
          failures++;
          console.error('[process] DB write error', e, { scanId, hotelId: cell.hotelId, checkIn: cell.checkIn });
        }

        // ============ Booking.com Parallel Scan ============
        if (cell.bookingUrl && cell.bookingUrl.trim()) {
          if (cell.checkOut <= cell.checkIn) {
            console.warn('[process] BOOKING SCAN SKIPPED: Invalid date range', {
              hotelId: cell.hotelId,
              checkIn: cell.checkIn,
              checkOut: cell.checkOut,
            });
          } else {
            const bookingPromise = (async () => {
              try {
                console.log('[process] === BOOKING.COM SCAN STARTED ===');
                console.log('[process] Hotel ID:', cell.hotelId);
                console.log('[process] Check-in:', cell.checkIn);
                console.log('[process] Check-out:', cell.checkOut);
                
                const scraper = initBookingScraper();
                const bookingResult = await scraper.scrape({
                  hotelCode: cell.bookingUrl!,
                  checkInDate: cell.checkIn,
                  checkOutDate: cell.checkOut,
                  adults: 2,
                  children: 0,
                });

                const validStatuses = new Set(['green', 'red', 'error']);
                const bookingStatus: 'green' | 'red' | 'error' = 
                  validStatuses.has(bookingResult.status as any) && 
                  (bookingResult.status === 'green' || bookingResult.status === 'red' || bookingResult.status === 'error')
                    ? bookingResult.status
                    : 'red';

                const bookingData = bookingResult.scrapedData && typeof bookingResult.scrapedData === 'object'
                  ? { ...bookingResult.scrapedData, rooms: bookingResult.scrapedData.rooms || [], source: 'booking' }
                  : { rooms: [], source: 'booking' };

                try {
                  await sql`
                    INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status, response_json, source)
                    VALUES (${scanId}, ${cell.hotelId}, ${cell.checkIn}, ${bookingStatus}, ${JSON.stringify(bookingData)}, 'booking')
                    ON CONFLICT (scan_id, hotel_id, source, check_in_date)
                    DO UPDATE SET status = EXCLUDED.status, response_json = EXCLUDED.response_json
                  `;
                  bookingProcessed++;
                } catch (dbError: any) {
                  bookingFailures++;
                  console.error('[process] Booking DB write error:', dbError.message);
                }
              } catch (e: any) {
                bookingFailures++;
                console.error('[process] Booking scan error:', e.message);
                try {
                  const errorData = { 
                    error: e.message || String(e), 
                    rooms: [],
                    source: 'booking',
                  };
                  await sql`
                    INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status, response_json, source)
                    VALUES (${scanId}, ${cell.hotelId}, ${cell.checkIn}, 'error', ${JSON.stringify(errorData)}, 'booking')
                    ON CONFLICT (scan_id, hotel_id, source, check_in_date)
                    DO UPDATE SET status = EXCLUDED.status, response_json = EXCLUDED.response_json
                  `;
                } catch (dbError: any) {
                  console.error('[process] Booking error DB write failed:', dbError.message);
                }
              }
            })();
            bookingPromises.push(bookingPromise);
            bookingPromisesMeta.push({ hotelId: cell.hotelId, checkIn: cell.checkIn, checkOut: cell.checkOut });
          }
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    if (bookingPromises.length > 0) {
      console.log('[process] Waiting for', bookingPromises.length, 'Booking.com scans...');
      try {
        const BOOKING_TIMEOUT_MS = 25_000;
        let timeoutId: NodeJS.Timeout | null = null;
        const timeoutPromise = new Promise<'timeout'>((resolve) => {
          timeoutId = setTimeout(() => resolve('timeout'), BOOKING_TIMEOUT_MS);
        });

        const result = await Promise.race([
          Promise.allSettled(bookingPromises).then(() => 'completed' as const),
          timeoutPromise,
        ]);
        
        if (timeoutId && result === 'completed') clearTimeout(timeoutId);
        console.log('[process] Booking.com scans result:', result);
      } catch (e) {
        console.error('[process] Error waiting for Booking.com scans:', e);
      }
    }

    if (processed > 0) {
      await sql`UPDATE scans SET done_cells = LEAST(done_cells + ${processed}, ${total}) WHERE id = ${scanId}`;
    }

    const nextIndex = endIndex;
    const done = nextIndex >= total || stopEarly;
    if (done) {
      const curDone = (await sql`SELECT done_cells FROM scans WHERE id=${scanId}`).rows[0]?.done_cells ?? 0;
      if (curDone >= total) await sql`UPDATE scans SET status='done' WHERE id=${scanId}`;
    }

    console.log('[process] ===== PROCESSING COMPLETE =====');
    console.log('[process] Processed:', processed);
    console.log('[process] Failures:', failures);
    console.log('[process] Next Index:', nextIndex);
    console.log('[process] Done:', done);
    console.log('[process] Duration:', Date.now() - tStart, 'ms');

    return NextResponse.json({
      processed,
      failures,
      bookingProcessed,
      bookingFailures,
      nextIndex,
      done: nextIndex >= total,
      total,
      batchSize: slice.length,
      stopEarly,
    });
  } catch (e:any) {
    console.error('[POST /api/scans/process] fatal', e);
    return NextResponse.json({ error: 'Processing error' }, { status: 500 });
  }
}