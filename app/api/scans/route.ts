import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL =
  process.env.AMELLO_BASE_URL || 'https://prod-api.amello.plusline.net/api/v1';

function toYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function datesBerlin(startOffset: number, endOffset: number, anchor?: Date): string[] {
  const now = anchor ?? new Date();
  const berlinNow = new Date(
    now.toLocaleString('en-GB', { timeZone: 'Europe/Berlin' }),
  );
  const out: string[] = [];
  for (let off = startOffset; off <= endOffset; off++) {
    const d = new Date(berlinNow);
    d.setDate(d.getDate() + off);
    out.push(toYMD(d));
  }
  return out;
}

// GET /api/scans → list scans
export async function GET() {
  const { rows } = await sql`
    SELECT id, scanned_at, fixed_checkout, start_offset, end_offset, timezone
    FROM scans
    ORDER BY scanned_at DESC
  `;
  return NextResponse.json(rows);
}

// POST /api/scans → run a new scan and persist results
export async function POST(req: NextRequest) {
  const { startOffset = 5, endOffset = 90 } = await req.json().catch(() => ({}));
  const anchor = new Date();
  const checkInDates = datesBerlin(startOffset, endOffset, anchor);
  const fixedCheckout = datesBerlin(12, 12, anchor)[0];

  const scanIns = await sql`
    INSERT INTO scans (fixed_checkout, start_offset, end_offset, timezone)
    VALUES (${fixedCheckout}, ${startOffset}, ${endOffset}, 'Europe/Berlin')
    RETURNING id, scanned_at
  `;
  const scan = scanIns.rows[0] as { id: number; scanned_at: string };

  const hotels = (
    await sql`SELECT id, name, code FROM hotels ORDER BY id ASC`
  ).rows as Array<{ id: number; name: string; code: string }>;

  const results: Record<string, Record<string, 'green' | 'red'>> = {};

  // Simple sequential loop: fewer moving parts, no bundler issues
  for (const h of hotels) {
    results[h.code] = {};
    for (const checkIn of checkInDates) {
      const payload = {
        hotelId: h.code,
        departureDate: checkIn, // upstream field name; our check-in
        returnDate: fixedCheckout, // fixed checkout = today+12
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
      } catch {
        // keep red
      }

      results[h.code][checkIn] = status;

      await sql`
        INSERT INTO scan_results (scan_id, hotel_id, check_in_date, status)
        VALUES (${scan.id}, ${h.id}, ${checkIn}, ${status})
        ON CONFLICT (scan_id, hotel_id, check_in_date)
        DO UPDATE SET status = EXCLUDED.status
      `;
    }
  }

  return NextResponse.json({
    scanId: scan.id,
    dates: checkInDates,
    results,
    scannedAt: scan.scanned_at,
  });
}
