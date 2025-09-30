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
            const text = (await res.text()).trim();
            if (text.startsWith('data')) {
              status = 'green';
            } else {
              try {
                const j = JSON.parse(text);
                if (Object.prototype.hasOwnProperty.call(j, 'data')) status = 'green';
              } catch { /* keep red */ }
            }
          }
        } catch (e) {
          console.error('[POST /api/scans] upstream error:', e, { hotel: h.code, checkIn, checkOut });
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
