import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL =
  process.env.AMELLO_BASE_URL || 'https://prod-api.amello.plusline.net/api/v1';

/** Format a UTC Date to 'YYYY-MM-DD' without timezone surprises */
function toYMDFromUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Get today's calendar date in Europe/Berlin as {y,m,d} via Intl (no parsing) */
function todayBerlin(): { y: number; m: number; d: number } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // 'en-CA' gives 'YYYY-MM-DD'
  const [y, m, d] = fmt.format(now).split('-').map((n) => Number(n));
  return { y, m, d };
}

/**
 * Build an inclusive list of Berlin calendar dates (YYYY-MM-DD),
 * from today+startOffset to today+endOffset.
 * No locale parsing; we advance a UTC date object to avoid DST pitfalls.
 */
function berlinDateRangeYMD(startOffset: number, endOffset: number): string[] {
  const { y, m, d } = todayBerlin();
  // Start from Berlin-today at midnight calendar-wise: represent it as UTC date
  const base = new Date(Date.UTC(y, m - 1, d));
  const out: string[] = [];
  for (let off = startOffset; off <= endOffset; off++) {
    const dt = new Date(base); // clone
    dt.setUTCDate(dt.getUTCDate() + off);
    out.push(toYMDFromUTC(dt));
  }
  return out;
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
    // Read optional overrides; default to +5..+90 as discussed
    const txt = await req.text();
    let body: any = {};
    if (txt) {
      try {
        body = JSON.parse(txt);
      } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
      }
    }
    const { startOffset = 5, endOffset = 90 } = body;

    // Build Berlin check-in dates and fixed check-out (today+12, Berlin)
    const checkInDates = berlinDateRangeYMD(startOffset, endOffset);
    const [fixedCheckout] = berlinDateRangeYMD(12, 12);

    // Persist the scan header (fixed_checkout is a DATE column)
    const scanIns = await sql`
      INSERT INTO scans (fixed_checkout, start_offset, end_offset, timezone)
      VALUES (${fixedCheckout}, ${startOffset}, ${endOffset}, 'Europe/Berlin')
      RETURNING id, scanned_at
    `;
    const scan = scanIns.rows[0] as { id: number; scanned_at: string };

    // Fetch hotels
    const hotels = (
      await sql`SELECT id, name, code FROM hotels ORDER BY id ASC`
    ).rows as Array<{ id: number; name: string; code: string }>;

    const results: Record<string, Record<string, 'green' | 'red'>> = {};

    // Call upstream for each hotel/date and store cell result
    for (const h of hotels) {
      results[h.code] = {};
      for (const checkIn of checkInDates) {
        const payload = {
          hotelId: h.code,
          // Upstream field is named 'departureDate'; our business meaning is check-in
          departureDate: checkIn,
          returnDate: fixedCheckout,
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
              } catch {
                // keep red
              }
            }
          }
        } catch (e) {
          console.error('[POST /api/scans] upstream error:', e);
        }

        results[h.code][checkIn] = status;

        // Persist/Upsert cell
        try {
          await sql`
            INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status)
            VALUES (${scan.id}, ${h.id}, ${checkIn}, ${status})
            ON CONFLICT (scan_id, hotel_id, check_in_date)
            DO UPDATE SET status = EXCLUDED.status
          `;
        } catch (e) {
          console.error('[POST /api/scans] DB write error:', e, {
            scanId: scan.id,
            hotelId: h.id,
            checkIn,
            status,
          });
        }
      }
    }

    return NextResponse.json({
      scanId: scan.id,
      dates: checkInDates,
      results,
      scannedAt: scan.scanned_at,
    });
  } catch (err: any) {
    console.error('[POST /api/scans] fatal error:', err);
    return NextResponse.json({ error: 'Scan failed' }, { status: 500 });
  }
}
