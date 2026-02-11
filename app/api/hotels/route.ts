import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type IncomingHotel = {
  name: string;
  code: string;
  brand?: string | null;
  region?: string | null;
  country?: string | null;
  booking_url?: string | null;
  tuiamello_url?: string | null;
  expedia_url?: string | null;
  booking_com_url?: string | null;
};

export async function GET() {
  const { rows } = await sql`
    SELECT id, name, code, COALESCE(brand,'') AS brand, COALESCE(region,'') AS region, COALESCE(country,'') AS country,
           booking_url, tuiamello_url, expedia_url, booking_com_url
    FROM hotels
    ORDER BY id ASC
  `;
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const payload: IncomingHotel[] = Array.isArray(body) ? body : [body];

    // Validate
    const values = payload
      .filter(h => h && typeof h.name === 'string' && typeof h.code === 'string' && h.name.trim() && h.code.trim())
      .map(h => ({
        name: h.name.trim(),
        code: h.code.trim(),
        brand: (h.brand ?? '').toString().trim() || null,
        region: (h.region ?? '').toString().trim() || null,
        country: (h.country ?? '').toString().trim() || null,
        booking_url: (h.booking_url ?? '').toString().trim() || null,
        tuiamello_url: (h.tuiamello_url ?? '').toString().trim() || null,
        expedia_url: (h.expedia_url ?? '').toString().trim() || null,
        booking_com_url: (h.booking_com_url ?? '').toString().trim() || null,
      }));

    if (values.length === 0) {
      return NextResponse.json({ error: 'No valid hotels' }, { status: 400 });
    }

    // Upsert each (kept simple/explicit for clarity)
    for (const v of values) {
      await sql`
        INSERT INTO hotels (name, code, brand, region, country, booking_url, tuiamello_url, expedia_url, booking_com_url)
        VALUES (${v.name}, ${v.code}, ${v.brand}, ${v.region}, ${v.country}, ${v.booking_url}, ${v.tuiamello_url}, ${v.expedia_url}, ${v.booking_com_url})
        ON CONFLICT (code)
        DO UPDATE SET name = EXCLUDED.name,
                      brand = EXCLUDED.brand,
                      region = EXCLUDED.region,
                      country = EXCLUDED.country,
                      booking_url = EXCLUDED.booking_url,
                      tuiamello_url = EXCLUDED.tuiamello_url,
                      expedia_url = EXCLUDED.expedia_url,
                      booking_com_url = EXCLUDED.booking_com_url
      `;
    }

    const { rows } = await sql`
      SELECT id, name, code, COALESCE(brand,'') AS brand, COALESCE(region,'') AS region, COALESCE(country,'') AS country,
             booking_url, tuiamello_url, expedia_url, booking_com_url
      FROM hotels
      ORDER BY id ASC
    `;
    return NextResponse.json(rows);
  } catch (e: any) {
    console.error('[POST /api/hotels] error', e);
    return NextResponse.json({ error: 'failed to save hotels' }, { status: 500 });
  }
}
