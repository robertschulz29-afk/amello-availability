import { NextRequest, NextResponse } from 'next/server';
import { sql, query } from '@/lib/db';

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
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const collectorsParam = searchParams.get('collectors');
  const collectorIds = collectorsParam
    ? collectorsParam.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    : [];

  if (collectorIds.length === 0) {
    const { rows } = await sql`
      SELECT id, name, code, COALESCE(brand,'') AS brand, COALESCE(region,'') AS region, COALESCE(country,'') AS country,
             booking_url, tuiamello_url, expedia_url, bookable, active, base_image, "globalTypes"
      FROM hotels
      ORDER BY id ASC
    `;
    return NextResponse.json(rows);
  }

  // For each collector: OR across its assigned global_type codes (hotel must have at least one).
  // Between collectors: AND (hotel must satisfy every selected collector).
  // Code matching: exact OR prefix "code/..." (slash-separated subtype format).
  const { rows: typeRows } = await query(
    `SELECT group_id, global_type FROM global_types WHERE group_id = ANY($1)`,
    [collectorIds],
  );

  // Group codes by collector id
  const byCollector: Record<number, string[]> = {};
  for (const { group_id, global_type } of typeRows) {
    if (!byCollector[group_id]) byCollector[group_id] = [];
    byCollector[group_id].push(global_type);
  }

  // Build one OR-block per collector, AND the blocks together
  const params: string[] = [];
  const andClauses = collectorIds.map(cid => {
    const codes = byCollector[cid] ?? [];
    if (codes.length === 0) return 'FALSE';
    const orParts = codes.map(code => {
      params.push(code);
      const i = params.length;
      return `EXISTS (
        SELECT 1 FROM jsonb_array_elements_text("globalTypes"::jsonb) AS elem
        WHERE elem = $${i} OR elem LIKE ($${i} || '/%')
      )`;
    });
    return `(${orParts.join(' OR ')})`;
  });

  if (andClauses.every(c => c === 'FALSE')) {
    return NextResponse.json([]);
  }

  const { rows } = await query(
    `SELECT id, name, code, COALESCE(brand,'') AS brand, COALESCE(region,'') AS region, COALESCE(country,'') AS country,
            booking_url, tuiamello_url, expedia_url, bookable, active, base_image, "globalTypes"
     FROM hotels
     WHERE "globalTypes" IS NOT NULL AND ${andClauses.join(' AND ')}
     ORDER BY id ASC`,
    params,
  );
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
      }));

    if (values.length === 0) {
      return NextResponse.json({ error: 'No valid hotels' }, { status: 400 });
    }

    // Upsert each (kept simple/explicit for clarity)
    for (const v of values) {
      await sql`
        INSERT INTO hotels (name, code, brand, region, country, booking_url, tuiamello_url, expedia_url)
        VALUES (${v.name}, ${v.code}, ${v.brand}, ${v.region}, ${v.country}, ${v.booking_url}, ${v.tuiamello_url}, ${v.expedia_url})
        ON CONFLICT (code)
        DO UPDATE SET name = EXCLUDED.name,
                      brand = EXCLUDED.brand,
                      region = EXCLUDED.region,
                      country = EXCLUDED.country,
                      booking_url = EXCLUDED.booking_url,
                      tuiamello_url = EXCLUDED.tuiamello_url,
                      expedia_url = EXCLUDED.expedia_url
      `;
    }

    const { rows } = await sql`
      SELECT id, name, code, COALESCE(brand,'') AS brand, COALESCE(region,'') AS region, COALESCE(country,'') AS country,
             booking_url, tuiamello_url, expedia_url
      FROM hotels
      ORDER BY id ASC
    `;
    return NextResponse.json(rows);
  } catch (e: any) {
    console.error('[POST /api/hotels] error', e);
    return NextResponse.json({ error: 'failed to save hotels' }, { status: 500 });
  }
}
