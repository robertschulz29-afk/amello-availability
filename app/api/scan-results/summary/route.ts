import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type ScanSummary = {
  amello_cheaper: number;
  booking_cheaper: number;
  same_price: number;
  amello_only: number;
  booking_only: number;
};

/* GET: aggregate price-comparison counts for an entire scan */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const scanIDParam = searchParams.get('scanID');
    const hotelIDParam = searchParams.get('hotelId');

    if (!scanIDParam) {
      return NextResponse.json({ error: 'scanID is required' }, { status: 400 });
    }

    const scanID = parseInt(scanIDParam, 10);
    const hotelIDs = hotelIDParam
      ? hotelIDParam.split(',').map(s => parseInt(s.trim(), 10)).filter(n => isFinite(n))
      : [];

    const conditions: string[] = ['sr.scan_id = $1'];
    const params: (number | string)[] = [scanID];
    let paramCount = 1;

    if (hotelIDs.length === 1) {
      paramCount++;
      conditions.push(`sr.hotel_id = $${paramCount}`);
      params.push(hotelIDs[0]);
    } else if (hotelIDs.length > 1) {
      const placeholders = hotelIDs.map(() => `$${++paramCount}`).join(', ');
      conditions.push(`sr.hotel_id IN (${placeholders})`);
      params.push(...hotelIDs);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const summaryQuery = `
      WITH extracted_data AS (
        SELECT
          sr.hotel_id,
          sr.source,
          sr.status,
          CASE
            WHEN sr.status = 'green' AND sr.response_json->'rooms' IS NOT NULL THEN
              (SELECT jsonb_agg(
                jsonb_build_object(
                  'room_name', room->>'name',
                  'rate_name', rate->>'name',
                  'price', (rate->>'actualPrice')::numeric,
                  'currency', rate->>'currency'
                )
              )
              FROM jsonb_array_elements(sr.response_json->'rooms') AS room,
                   jsonb_array_elements(room->'rates') AS rate)
            ELSE NULL
          END AS room_rates
        FROM scan_results sr
        ${whereClause}
      ),
      flattened_data AS (
        SELECT
          ed.hotel_id,
          ed.source,
          rr->>'room_name' AS room_name,
          rr->>'rate_name' AS rate_name,
          (rr->>'price')::numeric AS price
        FROM extracted_data ed,
             jsonb_array_elements(COALESCE(ed.room_rates, '[]'::jsonb)) AS rr
        WHERE ed.room_rates IS NOT NULL
      ),
      pivoted AS (
        SELECT
          hotel_id,
          room_name,
          rate_name,
          MAX(CASE WHEN source = 'amello' THEN price END) AS price_amello,
          MAX(CASE WHEN source = 'booking' THEN price END) AS price_booking
        FROM flattened_data
        GROUP BY hotel_id, room_name, rate_name
      )
      SELECT
        COUNT(*) FILTER (WHERE price_amello IS NOT NULL AND price_booking IS NOT NULL AND price_amello < price_booking)::int AS amello_cheaper,
        COUNT(*) FILTER (WHERE price_amello IS NOT NULL AND price_booking IS NOT NULL AND price_booking < price_amello)::int AS booking_cheaper,
        COUNT(*) FILTER (WHERE price_amello IS NOT NULL AND price_booking IS NOT NULL AND price_amello = price_booking)::int AS same_price,
        COUNT(*) FILTER (WHERE price_amello IS NOT NULL AND price_booking IS NULL)::int AS amello_only,
        COUNT(*) FILTER (WHERE price_amello IS NULL AND price_booking IS NOT NULL)::int AS booking_only
      FROM pivoted
    `;

    const { rows } = await query<ScanSummary>(summaryQuery, params);
    const result: ScanSummary = rows[0] ?? {
      amello_cheaper: 0,
      booking_cheaper: 0,
      same_price: 0,
      amello_only: 0,
      booking_only: 0,
    };

    return NextResponse.json(result);
  } catch (e: any) {
    console.error('[GET /api/scan-results/summary] error', e);
    return NextResponse.json(
      { error: e.message || 'Failed to fetch scan summary' },
      { status: 500 }
    );
  }
}
