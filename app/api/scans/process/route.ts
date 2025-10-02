// app/api/scans/process/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // safe per-call budget

const BASE_URL =
  process.env.AMELLO_BASE_URL || 'https://prod-api.amello.plusline.net/api/v1';

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
function offsetsToDates(startOffset: number, endOffset: number): string[] {
  const base = berlinToday();
  const out: string[] = [];
  for (let off = startOffset; off <= endOffset; off++) {
    const dt = new Date(base);
    dt.setUTCDate(dt.getUTCDate() + off);
    out.push(toYMDUTC(dt));
  }
  return out;
}
function addDaysYMD(ymd: string, days: number): string {
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

type Cell = { hotelId: number; hotelCode: string; checkIn: string; checkOut: string };

export async function POST(req: NextRequest) {
  try {
    const { scanId, startIndex = 0, size = 50 } = await req.json();

    if (!Number.isFinite(scanId) || scanId <= 0) {
      return NextResponse.json({ error: 'Invalid scanId' }, { status: 400 });
    }

    // Load the scan parameters
    const s = await sql<{
      id: number; start_offset: number; end_offset: number; stay_nights: number;
      total_cells: number; done_cells: number; status: string
    }>`SELECT id, start_offset, end_offset, stay_nights, total_cells, done_cells, status
       FROM scans WHERE id = ${scanId}`;
    if (s.rows.length === 0) return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
    const scan = s.rows[0];

    // Early-out if already done
    if (scan.status === 'done') {
      return NextResponse.json({ processed: 0, nextIndex: scan.total_cells, done: true });
    }

    // Hotels + date list
    const hotels = (await sql<{ id:number; code:string }>`
      SELECT id, code FROM hotels ORDER BY id ASC
    `).rows;
    const dates = offsetsToDates(scan.start_offset, scan.end_offset);

    const total = hotels.length * dates.length;

    // Build flat work array (deterministic order)
    const work: Cell[] = [];
    for (const h of hotels) {
      for (const d of dates) {
        work.push({
          hotelId: h.id,
          hotelCode: h.code,
          checkIn: d,
          checkOut: addDaysYMD(d, scan.stay_nights),
        });
      }
    }

    const start = Math.max(0, Math.min(startIndex, total));
    const end = Math.min(total, start + Math.max(1, size));
    if (start >= end) {
      // Mark done if not already
      await sql`UPDATE scans SET status='done', done_cells=${total} WHERE id=${scanId} AND status <> 'done'`;
      return NextResponse.json({ processed: 0, nextIndex: total, done: true });
    }

    const slice = work.slice(start, end);

    // Small concurrency pool (8) to keep upstream happy
    const concurrency = 8;
    let i = 0;
    let processed = 0;

    async function worker() {
      while (true) {
        const idx = i++;
        if (idx >= slice.length) break;
        const cell = slice[idx];

        let status: 'green' | 'red' = 'red';
        try {
          const payload = {
            hotelId: cell.hotelCode,
            departureDate: cell.checkIn,
            returnDate: cell.checkOut,
            currency: 'EUR',
            roomConfigurations: [
              { travellers: { id: 1, adultCount: 1, childrenAges: [] } },
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
              const j: any = await res.json();
              status = hasNonEmptyRooms(j) ? 'green' : 'red';
            } else {
              status = 'red';
            }
          } else {
            status = 'red';
          }
        } catch (e) {
          // network/parse error → red
          console.error('[process] upstream error', e, cell);
          status = 'red';
        }

        // Persist cell
        try {
          await sql`
            INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status)
            VALUES (${scanId}, ${cell.hotelId}, ${cell.checkIn}, ${status})
            ON CONFLICT (scan_id, hotel_id, check_in_date)
            DO UPDATE SET status = EXCLUDED.status
          `;
        } catch (e) {
          console.error('[process] DB write error', e, cell);
        }

        processed++;
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    // Bump progress
    await sql`
      UPDATE scans
      SET done_cells = LEAST(done_cells + ${processed}, ${total})
      WHERE id = ${scanId}
    `;

    const nextIndex = end;
    const done = nextIndex >= total;
    if (done) {
      await sql`UPDATE scans SET status='done' WHERE id=${scanId}`;
    }

    return NextResponse.json({ processed, nextIndex, done, total });
  } catch (e:any) {
    console.error('[POST /api/scans/process] fatal', e);
    return NextResponse.json({ error: 'Processing error' }, { status: 500 });
  }
}
