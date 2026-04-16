import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { DEFAULT_BELLO_MANDATOR } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AMELLO_BASE = 'https://prod-api.amello.plusline.net/api/v1';
const LOCALE = 'en_DE';

const AMELLO_HEADERS = {
  'Content-Type': 'application/json',
  'Bello-Mandator': DEFAULT_BELLO_MANDATOR,
};

async function amelloFetch(url: string): Promise<any> {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: AMELLO_HEADERS,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

export async function POST(): Promise<NextResponse> {
  const errors: string[] = [];

  // ── Step 1: fetch hotel reference list ──────────────────────────────────
  let refData: any;
  try {
    refData = await amelloFetch(`${AMELLO_BASE}/hotel-reference?locale=${LOCALE}`);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Step 1 failed: ${e.message}` },
      { status: 502 },
    );
  }

  // Collect unique codes across all source keys (crapi, etc.)
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const source of Object.values(refData?.hotels ?? {})) {
    if (!Array.isArray(source)) continue;
    for (const h of source as { code?: string }[]) {
      if (h?.code && !seen.has(h.code)) {
        seen.add(h.code);
        codes.push(h.code);
      }
    }
  }

  if (codes.length === 0) {
    return NextResponse.json(
      { error: 'No hotel codes found', refDataSample: JSON.stringify(refData).slice(0, 500) },
      { status: 502 },
    );
  }

  // ── Step 2: fetch detail for each hotel in parallel ──────────────────────
  type Row = {
    name: string;
    code: string;
    brand: string | null;
    base_image: string | null;
    region: string | null;
    country: string | null;
    bookable: boolean;
    active: boolean;
  };

  const rows: Row[] = [];
  const successfulCodes: string[] = [];

  await Promise.allSettled(
    codes.map(async (code) => {
      try {
        const body = await amelloFetch(`${AMELLO_BASE}/hotel/${code}?locale=${LOCALE}`);
        const d = body?.data ?? body;

        rows.push({
          name:       d.name              ?? code,
          code,
          brand:      d.brand?.name       ?? null,
          base_image: d.images?.[0]?.src  ?? null,
          region:     d.location?.region  ?? null,
          country:    d.location?.country ?? null,
          bookable:   d.bookable          ?? true,
          active:     !(d.inactive        ?? false), // API has `inactive`, DB has `active`
        });
        successfulCodes.push(code);
      } catch (e: any) {
        errors.push(`${code}: ${e.message}`);
      }
    }),
  );

  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'Could not fetch details for any hotels', errors },
      { status: 502 },
    );
  }

  // ── Step 3: upsert successfully fetched hotels ───────────────────────────
  // booking_url, tuiamello_url, expedia_url are NOT touched (manual fields)
  for (const v of rows) {
    await query(
      `INSERT INTO hotels (name, code, brand, base_image, region, country, bookable, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (code) DO UPDATE SET
         name       = EXCLUDED.name,
         brand      = EXCLUDED.brand,
         base_image = EXCLUDED.base_image,
         region     = EXCLUDED.region,
         country    = EXCLUDED.country,
         bookable   = EXCLUDED.bookable,
         active     = EXCLUDED.active`,
      [v.name, v.code, v.brand, v.base_image, v.region, v.country, v.bookable, v.active],
    );
  }

  // ── Step 4: mark hotels not in the API response as inactive ──────────────
  if (successfulCodes.length > 0) {
    await query(
      `UPDATE hotels
       SET active   = false,
           bookable = false
       WHERE code != ALL($1::text[])`,
      [successfulCodes],
    );
  }

  // ── Step 5: return full hotel list ───────────────────────────────────────
  const { rows: dbRows } = await query(
    `SELECT id, name, code,
            COALESCE(brand, '')   AS brand,
            COALESCE(region, '')  AS region,
            COALESCE(country, '') AS country,
            base_image, bookable, active,
            booking_url, tuiamello_url, expedia_url, "globalTypes"
     FROM hotels
     ORDER BY name ASC`,
  );

  return NextResponse.json({
    synced:  rows.length,
    skipped: errors.length,
    errors,
    hotels:  dbRows,
  });
}
