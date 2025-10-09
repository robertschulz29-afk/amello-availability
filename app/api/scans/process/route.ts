import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

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

    // Hotels
    const hotels = (await sql`SELECT id, code FROM hotels ORDER BY id ASC`).rows as Array<{ id:number; code:string }>;

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
    const slice: { hotelId:number; hotelCode:string; checkIn:string; checkOut:string }[] = [];
    for (let idx = startIndex; idx < endIndex; idx++) {
      const hotelIdx = Math.floor(idx / dates.length);
      const dateIdx  = idx % dates.length;
      const h = hotels[hotelIdx];

      const checkIn = dates[dateIdx];                    // already YMD
      const checkInDt = ymdToUTC(checkIn);
      checkInDt.setUTCDate(checkInDt.getUTCDate() + stayNights);
      const checkOut = toYMDUTC(checkInDt);

      slice.push({ hotelId: h.id, hotelCode: h.code, checkIn, checkOut });
    }

    const CONCURRENCY = 4;
    let i = 0;
    let processed = 0;
    let failures  = 0;
    let stopEarly = false;

    async function worker() {
      while (true) {
        if (Date.now() - tStart > SOFT_BUDGET_MS) { stopEarly = true; break; }
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
            roomConfigurations: [
              { travellers: { id: 1, adultCount: 2, childrenAges: [] } }, // adultCount = 2
            ],
            locale: 'de_DE',
          };

          const res = await fetch(`${BASE_URL}/hotel/offer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            cache: 'no-store',
          });

          if (res.status === 200) {
            const ctype = res.headers.get('content-type') || '';
            if (ctype.includes('application/json')) {
              const j = await res.json();
              responseJson = j;
              status = hasNonEmptyRooms(j) ? 'green' : 'red';
            } else {
              status = 'red';
              responseJson = { httpStatus: res.status, text: await res.text().catch(()=>null) };
            }
          } else {
            status = 'red';
            responseJson = { httpStatus: res.status, text: await res.text().catch(()=>null) };
          }
        } catch (e:any) {
          console.error('[process] upstream fetch error', e, cell);
          status = 'red';
          responseJson = { error: String(e) };
        }

        // Persist cell; ONLY count as processed on success
        try {
          await sql`
            INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status, response_json)
            VALUES (${scanId}, ${cell.hotelId}, ${cell.checkIn}, ${status}, ${responseJson})
            ON CONFLICT (scan_id, hotel_id, check_in_date)
            DO UPDATE SET status = EXCLUDED.status, response_json = EXCLUDED.response_json
          `;
          processed++;
        } catch (e) {
          failures++;
          console.error('[process] DB write error', e, { scanId, hotelId: cell.hotelId, checkIn: cell.checkIn });
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

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
