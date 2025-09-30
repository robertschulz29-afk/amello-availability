import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL =
  process.env.AMELLO_BASE_URL || 'https://prod-api.amello.plusline.net/api/v1';

/** Format a UTC Date to 'YYYY-MM-DD' */
function toYMDUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Berlin “today” (calendar day) via Intl without parsing locale strings */
function todayBerlin(): { y: number; m: number; d: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(new Date()).split('-').map(Number);
  return { y, m, d };
}

/** Inclusive range of YYYY-MM-DD check-in dates for Berlin today+start..end */
function berlinCheckinsYMD(startOffset: number, endOffset: number): string[] {
  const { y, m, d } = todayBerlin();
  const baseUTC = new Date(Date.UTC(y, m - 1, d));
  const out: string[] = [];
  for (let off = startOffset; off <= endOffset; off++) {
    const dt = new Date(baseUTC);
    dt.setUTCDate(dt.getUTCDate() + off);
    out.push(toYMDUTC(dt));
  }
  return out;
}

/** Add N days to a YYYY-MM-DD, return YYYY-MM-DD (UTC math) */
function addDaysYMD(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toYMDUTC(dt);
}

export async function GET() {
  try {
    const { rows } = await sql`
      SELECT id, scanned_at, fixed_checkout, start_offset, end_offset, timezone
      FROM scans
      ORDER BY scanned_at DESC
    `;
    return NextResponse.json(rows);
  } catch (err: any) {
    console.error('[GET /api/scans] error:', err);
    return NextResponse.json({ error: 'DB error listing scans' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Accept optional overrides; defaults: columns 5..90, stay 7 nights
    const txt = await req.text();
    let body: any = {};
    if (txt) {
      try { body = JSON.parse(txt); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    }
    const startOffset: number = Number.isFinite(body?.startOffset) ? body.startOffset : 5;
    const endOffset: number   = Number.isFinite(body?.endOffset)   ? body.endOffset   : 90;
    const stayNights: number  = Number.isFinite(body?.stayNights)  ? body.stayNights  : 7; // 12-5 = 7 in your example

    if (endOffset < startOffset) {
      return NextResponse.json({ error: 'endOffset must be >= startOffset' }, { status: 400 });
    }
    if (stayNights <= 0) {
      return NextResponse.json({ error: 'stayNights must be > 0' }, { status: 400 });
    }

    const checkIns = berlinCheckinsYMD(startOffset, endOffset);
    const firstCheckout = addDaysYMD(checkIns[0], stayNights); // stored just to keep schema happy

    // Persist scan header
    const scanIns = await sql`
      INSERT INTO scans (fixed_checkout, start_offset, end_offset, timezone)
      VALUES (${firstCheckout}, ${startOffset}, ${endOffset}, 'Europe/Berlin')
      RETURNING id, scanned_at
    `;
    const scan = scanIns.rows[0] as { id: number; scanned_at: string };

    // Hotels
    const hotels = (await sql`
      SELECT id, name, code FROM hotels ORDER BY id ASC
    `).rows as Array<{ id: number; name: string; code: string }>;

    const results: Record<string, Record<string, 'green' | 'red'>> = {};

    // Iterate hotels × dates
    for (const h of hotels) {
      results[h.code] = {};
      for (const checkIn of checkIns) {
        const checkOut = addDaysYMD(checkIn, stayNights);

        const payload = {
          hotelId: h.code,
          // Upstream names are departure/return; business meaning is check-in/out
          departureDate: checkIn,
          returnDate: checkOut,
          currency: 'EUR',
          roomConfigurations: [
            { travellers: { id: 1, adultCount: 1, childrenAges: [] } },
          ],
          locale: 'de_DE',
        };

        let status: 'green' | 'red' = 'red';
try {
  const res = await fetch(`${BASE_URL}/hotel/offer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  if (res.status === 200) {
    // Only trust JSON if server says it's JSON
    const ctype = res.headers.get('content-type') || '';
    if (ctype.includes('application/json')) {
      const j: any = await res.json();

      // helper to test "rooms" arrays in various shapes
      const hasNonEmptyRooms = (obj: any): boolean => {
        if (!obj || typeof obj !== 'object') return false;

        // case 1: top-level rooms
        if (Array.isArray(obj.rooms) && obj.rooms.length > 0) return true;

        // case 2: data.rooms
        if (obj.data && Array.isArray(obj.data.rooms) && obj.data.rooms.length > 0) return true;

        // case 3: some APIs wrap result deeper; do a shallow scan for a key named "rooms"
        for (const [k, v] of Object.entries(obj)) {
          if (k.toLowerCase() === 'rooms' && Array.isArray(v) && v.length > 0) return true;
        }
        return false;
      };

      status = hasNonEmptyRooms(j) ? 'green' : 'red';
    } else {
      // Non-JSON 200 → treat as red; optionally read text to debug:
      // const txt = await res.text(); console.log('non-JSON 200:', txt.slice(0,200));
      status = 'red';
    }
  } else {
    // non-200 → red
    status = 'red';
  }
} catch (e) {
  // network/parse error → red
  console.error('[POST /api/scans] upstream error:', e, { hotel: h.code, checkIn, checkOut });
  status = 'red';
}

        }

        results[h.code][checkIn] = status;

        // Persist cell
        try {
          await sql`
            INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status)
            VALUES (${scan.id}, ${h.id}, ${checkIn}, ${status})
            ON CONFLICT (scan_id, hotel_id, check_in_date)
            DO UPDATE SET status = EXCLUDED.status
          `;
        } catch (e) {
          console.error('[POST /api/scans] DB write error:', e, { scanId: scan.id, hotelId: h.id, checkIn, status });
        }
      }
    }

    return NextResponse.json({
      scanId: scan.id,
      scannedAt: scan.scanned_at,
      startOffset,
      endOffset,
      stayNights,
      dates: checkIns,
      results,
    });
  } catch (err: any) {
    console.error('[POST /api/scans] fatal error:', err);
    return NextResponse.json({ error: 'Scan failed' }, { status: 500 });
  }
}
