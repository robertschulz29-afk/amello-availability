import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { extractLowestPrice } from '@/lib/price-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RateComparisonRow {
  scan_id: number;
  hotel_id: number;
  hotel_name: string;
  check_in_date: string;
  amello_min_price: number | null;
  amello_currency: string | null;
  amello_room_name: string | null;
  amello_rate_name: string | null;
  booking_min_price: number | null;
  booking_member_min_price: number | null;
  booking_currency: string | null;
  booking_room_name: string | null;
  booking_rate_name: string | null;
  price_difference: number | null;
  percentage_difference: number | null;
}

/**
 * GET: Fetch rate comparison data showing the cheapest rates from Amello and Booking.com
 * per scan/hotel/check-in day
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    
    const scanIDParam = searchParams.get('scanID');
    const hotelIDParam = searchParams.get('hotelID');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100', 10)));
    const offset = (page - 1) * limit;

    const scanID = scanIDParam ? parseInt(scanIDParam, 10) : null;
    const hotelIDs = hotelIDParam
      ? hotelIDParam.split(',').map(s => parseInt(s.trim(), 10)).filter(n => isFinite(n))
      : [];

    // Build WHERE conditions
    const conditions: string[] = ['sr.status = $1']; // Only include successful scans
    const params: (string | number)[] = ['green'];
    let paramCount = 1;

    if (scanID !== null) {
      paramCount++;
      conditions.push(`sr.scan_id = $${paramCount}`);
      params.push(scanID);
    }
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

    // Query to extract the minimum price per scan/hotel/check-in day/source
    const dataQuery = `
      WITH price_data AS (
        SELECT 
          sr.scan_id,
          sr.hotel_id,
          h.name as hotel_name,
          sr.check_in_date,
          sr.source,
          sr.response_json,
          -- Extract all room/rate combinations from the response_json
          CASE
            WHEN sr.response_json->'rooms' IS NOT NULL THEN
              (SELECT jsonb_agg(
                jsonb_build_object(
                  'room_name', room->>'name',
                  'rate_name', rate->>'name',
                  'price', (rate->>'price')::numeric,
                  'member_price', CASE WHEN rate->>'memberPrice' IS NOT NULL THEN (rate->>'memberPrice')::numeric ELSE NULL END,
                  'currency', rate->>'currency'
                )
              )
              FROM jsonb_array_elements(sr.response_json->'rooms') AS room,
                   jsonb_array_elements(room->'rates') AS rate
              WHERE (rate->>'price')::numeric IS NOT NULL)
            ELSE NULL
          END as room_rates
        FROM scan_results sr
        LEFT JOIN hotels h ON sr.hotel_id = h.id
        ${whereClause}
      ),
      min_prices AS (
        SELECT
          pd.scan_id,
          pd.hotel_id,
          pd.hotel_name,
          pd.check_in_date,
          pd.source,
          MIN((rr->>'price')::numeric) as min_price,
          (
            SELECT jsonb_build_object(
              'room_name', rr2->>'room_name',
              'rate_name', rr2->>'rate_name',
              'member_price', rr2->>'member_price',
              'currency', rr2->>'currency'
            )
            FROM jsonb_array_elements(pd.room_rates) AS rr2
            WHERE (rr2->>'price')::numeric = MIN((rr->>'price')::numeric)
            LIMIT 1
          ) as min_rate_details
        FROM price_data pd,
             jsonb_array_elements(COALESCE(pd.room_rates, '[]'::jsonb)) AS rr
        WHERE pd.room_rates IS NOT NULL
        GROUP BY pd.scan_id, pd.hotel_id, pd.hotel_name, pd.check_in_date, pd.source, pd.room_rates
      )
      SELECT
        mp.scan_id,
        mp.hotel_id,
        mp.hotel_name,
        mp.check_in_date::text,
        MAX(CASE WHEN mp.source = 'amello' THEN mp.min_price END) as amello_min_price,
        MAX(CASE WHEN mp.source = 'amello' THEN mp.min_rate_details->>'currency' END) as amello_currency,
        MAX(CASE WHEN mp.source = 'amello' THEN mp.min_rate_details->>'room_name' END) as amello_room_name,
        MAX(CASE WHEN mp.source = 'amello' THEN mp.min_rate_details->>'rate_name' END) as amello_rate_name,
        MAX(CASE WHEN mp.source = 'booking' THEN mp.min_price END) as booking_min_price,
        MAX(CASE WHEN mp.source = 'booking' THEN (mp.min_rate_details->>'member_price')::numeric END) as booking_member_min_price,
        MAX(CASE WHEN mp.source = 'booking' THEN mp.min_rate_details->>'currency' END) as booking_currency,
        MAX(CASE WHEN mp.source = 'booking' THEN mp.min_rate_details->>'room_name' END) as booking_room_name,
        MAX(CASE WHEN mp.source = 'booking' THEN mp.min_rate_details->>'rate_name' END) as booking_rate_name,
        -- Calculate price difference (Amello - Booking)
        MAX(CASE WHEN mp.source = 'amello' THEN mp.min_price END) - 
        MAX(CASE WHEN mp.source = 'booking' THEN mp.min_price END) as price_difference,
        -- Calculate percentage difference
        CASE 
          WHEN MAX(CASE WHEN mp.source = 'booking' THEN mp.min_price END) IS NOT NULL 
           AND MAX(CASE WHEN mp.source = 'booking' THEN mp.min_price END) > 0
          THEN 
            ((MAX(CASE WHEN mp.source = 'amello' THEN mp.min_price END) - 
              MAX(CASE WHEN mp.source = 'booking' THEN mp.min_price END)) / 
              MAX(CASE WHEN mp.source = 'booking' THEN mp.min_price END) * 100)
          ELSE NULL
        END as percentage_difference
      FROM min_prices mp
      GROUP BY mp.scan_id, mp.hotel_id, mp.hotel_name, mp.check_in_date
      HAVING MAX(CASE WHEN mp.source = 'amello' THEN mp.min_price END) IS NOT NULL
         OR MAX(CASE WHEN mp.source = 'booking' THEN mp.min_price END) IS NOT NULL
      ORDER BY mp.scan_id DESC, mp.hotel_id, mp.check_in_date
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;

    const { rows: dataRows } = await query<RateComparisonRow>(dataQuery, [...params, limit, offset]);

    // Count query
    const countQuery = `
      WITH price_data AS (
        SELECT 
          sr.scan_id,
          sr.hotel_id,
          h.name as hotel_name,
          sr.check_in_date,
          sr.source,
          sr.response_json,
          CASE 
            WHEN sr.response_json->'rooms' IS NOT NULL THEN
              (SELECT jsonb_agg(
                jsonb_build_object(
                  'room_name', room->>'name',
                  'rate_name', rate->>'name',
                  'price', (rate->>'price')::numeric,
                  'currency', rate->>'currency'
                )
              )
              FROM jsonb_array_elements(sr.response_json->'rooms') AS room,
                   jsonb_array_elements(room->'rates') AS rate
              WHERE (rate->>'price')::numeric IS NOT NULL)
            ELSE NULL
          END as room_rates
        FROM scan_results sr
        LEFT JOIN hotels h ON sr.hotel_id = h.id
        ${whereClause}
      ),
      min_prices AS (
        SELECT 
          pd.scan_id,
          pd.hotel_id,
          pd.check_in_date,
          pd.source,
          MIN((rr->>'price')::numeric) as min_price
        FROM price_data pd,
             jsonb_array_elements(COALESCE(pd.room_rates, '[]'::jsonb)) AS rr
        WHERE pd.room_rates IS NOT NULL
        GROUP BY pd.scan_id, pd.hotel_id, pd.check_in_date, pd.source
      )
      SELECT COUNT(DISTINCT (mp.scan_id, mp.hotel_id, mp.check_in_date))::int as total
      FROM min_prices mp
    `;

    const { rows: countRows } = await query<{ total: number }>(countQuery, params);
    const total = countRows[0]?.total || 0;

    return NextResponse.json({
      data: dataRows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (e: any) {
    console.error('[GET /api/rate-comparison] error', e);
    return NextResponse.json(
      { error: e.message || 'Failed to fetch rate comparison data' },
      { status: 500 }
    );
  }
}
