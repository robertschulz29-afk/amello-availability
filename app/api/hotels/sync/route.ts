import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { DEFAULT_BELLO_MANDATOR } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AMELLO_BASE = 'https://prod-api.amello.plusline.net/api/v1';
const LOCALE = 'en_DE';
const TUI_GRAPHQL = 'https://prod.api.tui/content/graphql';
const TUI_REST = 'https://prod.api.tui/content/hotels';

const AMELLO_HEADERS = {
  'Content-Type': 'application/json',
  'Bello-Mandator': DEFAULT_BELLO_MANDATOR,
};

async function amelloFetch(url: string): Promise<any> {
  const res = await fetch(url, { cache: 'no-store', headers: AMELLO_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

// ── Mode: amello — fetch hotel list + details from Amello API, upsert to DB ──

async function syncAmello(): Promise<NextResponse> {
  const errors: string[] = [];

  // Step 1: fetch hotel reference list
  let refData: any;
  try {
    refData = await amelloFetch(`${AMELLO_BASE}/hotel-reference?locale=${LOCALE}`);
  } catch (e: any) {
    return NextResponse.json({ error: `Step 1 failed: ${e.message}` }, { status: 502 });
  }

  const codes: string[] = [];
  const seen = new Set<string>();
  for (const source of Object.values(refData?.hotels ?? {})) {
    if (!Array.isArray(source)) continue;
    for (const h of source as { code?: string }[]) {
      if (h?.code && !seen.has(h.code)) { seen.add(h.code); codes.push(h.code); }
    }
  }

  if (codes.length === 0) {
    return NextResponse.json(
      { error: 'No hotel codes found', refDataSample: JSON.stringify(refData).slice(0, 500) },
      { status: 502 },
    );
  }

  // Step 2: fetch detail for each hotel in parallel
  type Row = { name: string; code: string; brand: string | null; base_image: string | null; region: string | null; country: string | null; bookable: boolean; active: boolean };
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
          active:     !(d.inactive        ?? false),
        });
        successfulCodes.push(code);
      } catch (e: any) {
        errors.push(`${code}: ${e.message}`);
      }
    }),
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Could not fetch details for any hotels', errors }, { status: 502 });
  }

  // Step 3: upsert hotels (manual fields booking_url etc. not touched)
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

  // Step 4: mark hotels not returned by API as inactive
  if (successfulCodes.length > 0) {
    await query(
      `UPDATE hotels SET active = false, bookable = false WHERE code != ALL($1::text[])`,
      [successfulCodes],
    );
  }

  // Step 5: return full hotel list
  const { rows: dbRows } = await query(
    `SELECT id, name, code,
            COALESCE(brand, '')   AS brand,
            COALESCE(region, '')  AS region,
            COALESCE(country, '') AS country,
            base_image, bookable, active,
            booking_url, tuiamello_url, expedia_url, "globalTypes"
     FROM hotels ORDER BY name ASC`,
  );

  return NextResponse.json({ synced: rows.length, skipped: errors.length, errors, hotels: dbRows });
}

// ── Mode: crapi — update globalTypes + cr_api_rooms from TUI APIs ────────────

async function syncCrApi(): Promise<NextResponse> {
  const errors: string[] = [];

  // Load all active+bookable hotel codes from DB
  const { rows: hotelRows } = await query<{ id: number; code: string }>(
    `SELECT id, code FROM hotels WHERE active = true AND bookable = true ORDER BY code`,
    [],
  );

  if (hotelRows.length === 0) {
    return NextResponse.json({ error: 'No active hotels in DB — run Amello sync first' }, { status: 400 });
  }

  let updated = 0;

  await Promise.allSettled(
    hotelRows.map(async ({ id: hotelId, code }) => {
      try {
        // GraphQL: hotel-level + room-level globalTypes
        const gqlRes = await fetch(TUI_GRAPHQL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `{ getHotelByCode(code: "${code}") { globalTypes details { rooms { globalTypes } } } }`,
          }),
          signal: AbortSignal.timeout(8000),
        });

        if (gqlRes.ok) {
          const gqlBody = await gqlRes.json();
          const hotel = gqlBody?.data?.getHotelByCode;
          const collected = new Set<string>();
          if (Array.isArray(hotel?.globalTypes)) {
            for (const v of hotel.globalTypes) { if (typeof v === 'string') collected.add(v); }
          }
          if (Array.isArray(hotel?.details?.rooms)) {
            for (const room of hotel.details.rooms) {
              if (Array.isArray(room?.globalTypes)) {
                for (const v of room.globalTypes) { if (typeof v === 'string') collected.add(v); }
              }
            }
          }
          const globalTypes = [...collected];
          if (globalTypes.length > 0) {
            await query(`UPDATE hotels SET "globalTypes" = $1 WHERE code = $2`, [JSON.stringify(globalTypes), code]);
          }
        }

        // REST API: room data (code, title, imageUrls)
        const restRes = await fetch(`${TUI_REST}/${code}?data=true&details=true`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (!restRes.ok) return;
        const restBody = await restRes.json();
        const rawRooms: any[] = restBody?.details?.rooms ?? [];

        for (const room of rawRooms) {
          const roomCode: string | null = room.code ?? null;
          if (!roomCode) continue;
          const roomName: string | null = room.title ?? null;
          const imageUrl: string | null = room.imageUrls?.[0] ?? null;
          await query(
            `INSERT INTO cr_api_rooms (hotel_id, name, room_code, image_url, global_types, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (hotel_id, room_code) DO UPDATE
               SET name      = EXCLUDED.name,
                   image_url = EXCLUDED.image_url,
                   updated_at = NOW()`,
            [hotelId, roomName, roomCode, imageUrl, JSON.stringify([])],
          );
        }

        updated++;
      } catch (e: any) {
        errors.push(`${code}: ${e.message}`);
      }
    }),
  );

  return NextResponse.json({ updated, skipped: errors.length, errors });
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('mode') ?? 'amello';

  if (mode === 'crapi') return syncCrApi();
  return syncAmello();
}
