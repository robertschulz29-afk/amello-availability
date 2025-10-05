// app/api/scans/process/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // keep within typical Vercel limits

const BASE_URL = process.env.AMELLO_BASE_URL || 'https://prod-api.amello.plusline.net/api/v1';

function toYMDUTC(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function berlinToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [y, m, d] = fmt.format(new Date()).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function offsetsToDates(startOffset: number, endOffset: number) {
  const base = berlinToday();
  const out: string[] = [];
  for (let off = startOffset; off <= endOffset; off++) {
    const dt = new Date(base);
    dt.setUTCDate(dt.getUTCDate() + off);
    out.push(toYMDUTC(dt));
  }
  return out;
}
function addDaysYMD(ymd: string, days: number) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toYMDUTC(dt);
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

export async function POST(req: NextRequest) {
  const tStart = Date.now();
  const SOFT_BUDGET_MS = 40_000; // stop work early to avoid platform timeout

  try {
    const body = await req.json().catch(() => ({}));
    const scanId = Number(body?.scanId);
    let startIndex = Number.isFinite(body?.startIndex) ? Number(body.startIndex) : 0;
    const size = Math.max(1, Math.min(200, Number.isFinite(body?.size) ? Number(body.size) : 50));

    if (!Number.isFinite(scanId) || scanId <= 0) {
      return NextResponse.json({ error: 'Invalid scanId' }, { status: 400 });
    }

    // Load scan parameters
    const s = await sql`SELECT id, start_offset, end_offset, stay_nights, total_cells, done_cells, status FROM scans WHERE id = ${scanId}`;
    if (s.rows.length === 0) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
    const scan = s.rows[0];

    // Load hotels + build dates
    const hotels = (await sql`SELECT id, code FROM hotels ORDER BY id ASC`).rows as Array<{ id:number; code:string }>;
    const dates = offsetsToDates(scan.start_offset, scan.end_offset);
    const total = hotels.length * dates.length;

    // clamp startIndex
    startIndex = Math.max(0, Math.min(startIndex, total));
    const endIndex = Math.min(total, startIndex + size);

    if (startIndex >= endIndex) {
      if ((scan.done_cells ?? 0) < total) {
        await sql`UPDATE scans SET done_cells = ${total}, status = 'done' WHERE id = ${scanId}`;
      }
      return NextResponse.json({ processed: 0, nextIndex: total, done: true, total });
    }

    // Build just the requested slice (flat mapping)
    const slice: { hotelId:number; hotelCode:string; checkIn:string; checkOut:string }[] = [];
    for (let idx = startIndex; idx < endIndex; idx++) {
      const hotelIdx = Math.floor(idx / dates.length);
      const dateIdx = idx % dates.length;
      const h = hotels[hotelIdx];
      const d = dates[dateIdx];
      slice.push({
        hotelId: h.id,
        hotelCode: h.code,
        checkIn: d,
        checkOut: addDaysYMD(d, scan.stay_nights),
      });
    }

    // Concurrency and processing
    const CONCURRENCY = 4;
    let i = 0;
    let processed = 0;
    let stopEarly = false;

    async function worker() {
      while (true) {
        if (Date.now() - tStart > SOFT_BUDGET_MS) {
          stopEarly = true;
          break;
        }
        const idx = i++;
        if (idx >= slice.length) break;
        const cell = slice[idx];

        let status: 'green' | 'red' = 'red';
        let responseJson: any = null;

        try {
          const payload = {
            hotelId: cell.hotelCode,
            // IMPORTANT: adultCount set to 2 per your instruction
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
              // not JSON; store minimal info
              status = 'red';
              responseJson = { httpStatus: res.status, text: await res.text().catch(()=>null) };
            }
          } else {
            status = 'red';
            // try to capture body for debugging
            const txt = await res.text().catch(()=>null);
            responseJson = { httpStatus: res.status, text: txt };
          }
        } catch (e:any) {
          console.error('[process] upstream error', e, cell);
          status = 'red';
          responseJson = { error: String(e) };
        }

        // Persist cell with response_json
        try {
          await sql`
            INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status, response_json)
            VALUES (${scanId}, ${cell.hotelId}, ${cell.checkIn}, ${status}, ${responseJson})
            ON CONFLICT (scan_id, hotel_id, check_in_date)
            DO UPDATE SET status = EXCLUDED.status, response_json = EXCLUDED.response_json
          `;
        } catch (e) {
          console.error('[process] DB write error', e, { scanId, hotelId: cell.hotelId, checkIn: cell.checkIn });
        }

        processed++;
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    // update progress
    await sql`UPDATE scans SET done_cells = LEAST(done_cells + ${processed}, ${total}) WHERE id = ${scanId}`;

    const nextIndex = endIndex;
    const done = nextIndex >= total || stopEarly;
    if (done) {
      const curDone = (await sql`SELECT done_cells FROM scans WHERE id = ${scanId}`).rows[0].done_cells;
      if (curDone >= total) {
        await sql`UPDATE scans SET status='done' WHERE id=${scanId}`;
      }
    }

    return NextResponse.json({ processed, nextIndex, done: nextIndex >= total, total });
  } catch (e:any) {
    console.error('[POST /api/scans/process] fatal', e);
    return NextResponse.json({ error: 'Processing error' }, { status: 500 });
  }
}
