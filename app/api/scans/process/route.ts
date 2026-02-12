import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { extractRoomRateData } from '@/lib/price-utils';
import { DEFAULT_BELLO_MANDATOR } from '@/lib/constants';
import { BookingComScraper } from '@/lib/scrapers/BookingComScraper';
import type { ScanSource } from '@/lib/scrapers/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  const tStart = Date.now();
  const SOFT_BUDGET_MS = 40_000;

  // Get the Bello-Mandator header from the incoming request
  // Middleware ensures this is present, but we default to DEFAULT_BELLO_MANDATOR as fallback
  const belloMandator = req.headers.get('Bello-Mandator') || DEFAULT_BELLO_MANDATOR;

  try {
    const body = await req.json().catch(() => ({}));
    const scanId = Number(body?.scanId);
    let startIndex = Number.isFinite(body?.startIndex) ? Number(body.startIndex) : 0;
    const size = Math.max(1, Math.min(200, Number.isFinite(body?.size) ? Number(body.size) : 50));

    if (!Number.isFinite(scanId) || scanId <= 0) {
      return NextResponse.json({ error: 'Invalid scanId' }, { status: 400 });
    }

    // Load scan parameters
    const s = await sql`
      SELECT id, base_checkin, days, stay_nights, start_offset, end_offset, total_cells, done_cells, status
      FROM scans WHERE id = ${scanId}
    `;
    if (s.rows.length === 0) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
    const scan = s.rows[0];

    // Build dates (prefer base_checkin/days, else legacy offsets)
    let dates: string[] = [];

    const baseYMD = normalizeYMD((scan as any).base_checkin);
    const daysNum = Number((scan as any).days);

    if (baseYMD && Number.isFinite(daysNum) && daysNum > 0) {
      dates = datesFromBase(baseYMD, daysNum);
    } else {
      // Legacy fallback using offsets relative to "today in Berlin"
      const berlinToday = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date()); // YYYY-MM-DD
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

    // Hotels (include booking_url for parallel Booking.com scanning)
    const hotels = (await sql`SELECT id, code, booking_url FROM hotels ORDER BY id ASC`).rows as Array<{ id:number; code:string; booking_url:string|null }>;


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

      const checkIn = dates[dateIdx];                    // already YMD
      const checkInDt = ymdToUTC(checkIn);
      checkInDt.setUTCDate(checkInDt.getUTCDate() + stayNights);
      const checkOut = toYMDUTC(checkInDt);

      slice.push({ hotelId: h.id, hotelCode: h.code, bookingUrl: h.booking_url, checkIn, checkOut });
    }

    const CONCURRENCY = 4;
    let i = 0;
    let processed = 0;
    let failures  = 0;
    let bookingProcessed = 0;
    let bookingFailures = 0;
    let stopEarly = false;

    // Collect Booking.com scan promises to await before returning response
    const bookingPromises: Promise<void>[] = [];
    // Track metadata for each booking promise for timeout logging
    const bookingPromisesMeta: Array<{ hotelId: number; checkIn: string; checkOut: string }> = [];

    // Initialize Booking.com scraper if needed (lazy initialization)
    let bookingScraper: BookingComScraper | null = null;
    const BOOKING_INTERNAL_SOURCE_ID = -1; // Negative ID to avoid conflicts with real DB records
    const initBookingScraper = () => {
      if (!bookingScraper) {
        // Create a minimal ScanSource config for Booking.com
        const bookingSource: ScanSource = {
          id: BOOKING_INTERNAL_SOURCE_ID,
          name: 'Booking.com',
          enabled: true,
          base_url: 'https://www.booking.com',
          css_selectors: null, // We'll parse HTML directly
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

        // ============ TUIAmello Scan (unchanged, just add source field) ============
        let status: 'green' | 'red' = 'red';
        let responseJson: any = null;

        try {
          const payload = {
            hotelId: cell.hotelCode,
            departureDate: cell.checkIn,
            returnDate: cell.checkOut,
            currency: 'EUR',
            roomConfigurations: [
              { travellers: { id: 1, adultCount: 2, childrenAges: [] } }, // adultCount = 2
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
              // Extract compact room/rate data instead of storing full response
              const compactData = extractRoomRateData(j);
              // Add source field
              responseJson = { ...compactData, source: 'amello' };
              // Check if we have any rooms with rates for status
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

        // Persist TUIAmello cell; ONLY count as processed on success
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

        // ============ Booking.com Parallel Scan (NEW) ============
        // Only scan if hotel has booking_url defined
        if (cell.bookingUrl && cell.bookingUrl.trim()) {
          // Validate checkIn < checkOut before starting scan
          const checkInDate = new Date(cell.checkIn);
          const checkOutDate = new Date(cell.checkOut);
          
          if (checkInDate >= checkOutDate) {
            console.warn('[process] === INVALID DATE RANGE - SKIPPING BOOKING SCAN ===');
            console.warn('[process] Hotel ID:', cell.hotelId);
            console.warn('[process] Check-in:', cell.checkIn, '>=', 'Check-out:', cell.checkOut);
            console.warn('[process] Booking URL:', cell.bookingUrl);
            // Skip this scan - don't create a promise
          } else {
            // Run Booking.com scan in parallel - collect promise to await later
            const bookingPromise = (async () => {
              try {
                console.log('[process] === BOOKING.COM SCAN STARTED ===');
                console.log('[process] Hotel ID:', cell.hotelId);
                console.log('[process] Booking URL:', cell.bookingUrl);
                console.log('[process] Check-in:', cell.checkIn);
                console.log('[process] Check-out:', cell.checkOut);
                
                const scraper = initBookingScraper();
                const bookingResult = await scraper.scrape({
                  hotelCode: cell.bookingUrl!, // Non-null assertion - we already checked it's not null above
                  checkInDate: cell.checkIn,
                  checkOutDate: cell.checkOut,
                  adults: 2,
                  children: 0,
                });

                console.log('[process] === BOOKING.COM SCAN COMPLETE ===');
                console.log('[process] Result status:', bookingResult.status);
                console.log('[process] Has scraped data:', !!bookingResult.scrapedData);
                if (bookingResult.scrapedData) {
                  const dataStr = JSON.stringify(bookingResult.scrapedData);
                  console.log('[process] Scraped data length:', dataStr.length, 'chars');
                  console.log('[process] Scraped data (truncated):', dataStr.substring(0, 200));
                }

                // Normalize booking status to valid values only
                let bookingStatus: 'green' | 'red' | 'error' = 'red';
                if (bookingResult.status === 'green' || bookingResult.status === 'red' || bookingResult.status === 'error') {
                  bookingStatus = bookingResult.status;
                } else {
                  console.warn('[process] Invalid booking status received:', bookingResult.status, '- defaulting to "red"');
                }

                // Normalize bookingData - ensure it's an object with rooms array
                const bookingData = bookingResult.scrapedData && typeof bookingResult.scrapedData === 'object'
                  ? { ...bookingResult.scrapedData, rooms: bookingResult.scrapedData.rooms || [], source: 'booking' }
                  : { rooms: [], source: 'booking' };

                console.log('[process] === DATABASE WRITE PHASE ===');
                console.log('[process] Scan ID:', scanId);
                console.log('[process] Hotel ID:', cell.hotelId);
                console.log('[process] Check-in date:', cell.checkIn);
                console.log('[process] Normalized status:', bookingStatus);
                console.log('[process] Source field:', 'booking');
                console.log('[process] Normalized data rooms count:', bookingData.rooms?.length || 0);
                console.log('[process] Data structure (truncated):', JSON.stringify(bookingData).substring(0, 100) + '...');

                try {
                  await sql`
                    INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status, response_json, source)
                    VALUES (${scanId}, ${cell.hotelId}, ${cell.checkIn}, ${bookingStatus}, ${JSON.stringify(bookingData)}, 'booking')
                    ON CONFLICT (scan_id, hotel_id, source, check_in_date)
                    DO UPDATE SET status = EXCLUDED.status, response_json = EXCLUDED.response_json
                  `;
                  
                  console.log('[process] ✓ Database write successful for Booking.com');
                  bookingProcessed++;
                } catch (dbError: any) {
                  bookingFailures++;
                  console.error('[process] === DATABASE WRITE FAILED ===');
                  console.error('[process] DB Error type:', dbError.name || 'Unknown');
                  console.error('[process] DB Error message:', dbError.message || 'No message');
                  console.error('[process] DB Error stack:', dbError.stack || 'No stack trace');
                  console.error('[process] Context:', {
                    hotelId: cell.hotelId,
                    checkIn: cell.checkIn,
                    checkOut: cell.checkOut,
                    bookingUrl: cell.bookingUrl,
                    scanId: scanId,
                  });
                }
              } catch (e: any) {
                bookingFailures++;
                console.error('[process] === BOOKING.COM SCAN ERROR (NON-BLOCKING) ===');
                console.error('[process] Error type:', e.name || 'Unknown');
                console.error('[process] Error message:', e.message || 'No message');
                console.error('[process] Error stack:', e.stack || 'No stack trace');
                console.error('[process] Context:', {
                  hotelId: cell.hotelId,
                  checkIn: cell.checkIn,
                  checkOut: cell.checkOut,
                  bookingUrl: cell.bookingUrl,
                  scanId: scanId,
                });
                
                // Store error result for Booking.com - ensure normalized structure
                try {
                  console.log('[process] === STORING ERROR RESULT IN DATABASE ===');
                  const errorData = { 
                    error: e.message || String(e), 
                    rooms: [],
                    source: 'booking',
                    errorType: e.name || 'Unknown',
                    stack: e.stack || 'No stack trace',
                  };
                  console.log('[process] Error data structure:', JSON.stringify(errorData).substring(0, 200));
                  
                  await sql`
                    INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status, response_json, source)
                    VALUES (
                      ${scanId}, 
                      ${cell.hotelId}, 
                      ${cell.checkIn}, 
                      'error',
                      ${JSON.stringify(errorData)},
                      'booking'
                    )
                    ON CONFLICT (scan_id, hotel_id, source, check_in_date)
                    DO UPDATE SET status = EXCLUDED.status, response_json = EXCLUDED.response_json
                  `;
                  console.log('[process] ✓ Error result stored successfully');
                } catch (dbError: any) {
                  console.error('[process] === DATABASE ERROR WRITE FAILED ===');
                  console.error('[process] DB Error type:', dbError.name || 'Unknown');
                  console.error('[process] DB Error message:', dbError.message || 'No message');
                  console.error('[process] DB Error stack:', dbError.stack || 'No stack trace');
                }
              }
            })();
            // CRITICAL: Push promise immediately after creation to ensure it's tracked
            bookingPromises.push(bookingPromise);
            bookingPromisesMeta.push({ hotelId: cell.hotelId, checkIn: cell.checkIn, checkOut: cell.checkOut });
          }
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    // Wait for all Booking.com scans to complete before returning response
    // This ensures database writes finish before serverless function terminates
    if (bookingPromises.length > 0) {
      console.log('[process] === WAITING FOR BOOKING.COM SCANS ===');
      console.log('[process] Total booking promises to await:', bookingPromises.length);
      
      try {
        // Use a timeout to prevent hanging (25s buffer for Vercel's 30s limit)
        const BOOKING_TIMEOUT_MS = 25_000;
        let timeoutId: NodeJS.Timeout | null = null;
        const timeoutPromise = new Promise<'timeout'>((resolve) => {
          timeoutId = setTimeout(() => {
            console.warn('[process] === BOOKING.COM SCANS TIMEOUT ===');
            console.warn('[process] Timeout after', BOOKING_TIMEOUT_MS, 'ms');
            console.warn('[process] Total promises started:', bookingPromises.length);
            console.warn('[process] Pending scans that may not have completed:');
            bookingPromisesMeta.forEach((meta, idx) => {
              console.warn(`[process]   - Scan ${idx + 1}: Hotel ${meta.hotelId}, Check-in: ${meta.checkIn}, Check-out: ${meta.checkOut}`);
            });
            
            resolve('timeout');
          }, BOOKING_TIMEOUT_MS);
        });

        const result = await Promise.race([
          Promise.allSettled(bookingPromises).then((results) => {
            // Log how many succeeded vs failed
            const fulfilled = results.filter(r => r.status === 'fulfilled').length;
            const rejected = results.filter(r => r.status === 'rejected').length;
            console.log('[process] === BOOKING.COM SCANS SETTLED ===');
            console.log('[process] Fulfilled:', fulfilled, 'Rejected:', rejected, 'Total:', results.length);
            return 'completed' as const;
          }),
          timeoutPromise,
        ]);
        
        // Clear timeout if promises completed first
        if (timeoutId && result === 'completed') {
          clearTimeout(timeoutId);
        }
        
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
