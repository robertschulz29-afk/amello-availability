import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const scanIDParam = searchParams.get('scanID');
    const hotelIDParam = searchParams.get('hotelID');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(5000, Math.max(1, parseInt(searchParams.get('limit') || '100', 10)));
    const offset = (page - 1) * limit;

    const scanID = scanIDParam ? parseInt(scanIDParam, 10) : null;
    const hotelIDs = hotelIDParam
      ? hotelIDParam.split(',').map(s => parseInt(s.trim(), 10)).filter(n => isFinite(n))
      : [];

    // Build base conditions (scan + hotel filter, no status filter)
    const baseConditions: string[] = [];
    const params: (string | number)[] = [];
    let paramCount = 0;

    if (scanID !== null) {
      paramCount++;
      baseConditions.push(`sr.scan_id = $${paramCount}`);
      params.push(scanID);
    }
    if (hotelIDs.length === 1) {
      paramCount++;
      baseConditions.push(`sr.hotel_id = $${paramCount}`);
      params.push(hotelIDs[0]);
    } else if (hotelIDs.length > 1) {
      const placeholders = hotelIDs.map(() => `$${++paramCount}`).join(', ');
      baseConditions.push(`sr.hotel_id IN (${placeholders})`);
      params.push(...hotelIDs);
    }

    const baseWhere = baseConditions.length > 0 ? `WHERE ${baseConditions.join(' AND ')}` : '';
    // price_data additionally requires green status
    const priceWhere = baseConditions.length > 0
      ? `WHERE ${baseConditions.join(' AND ')} AND sr.status = 'green'`
      : `WHERE sr.status = 'green'`;

    const dataQuery = `
      WITH scan_base AS (
        SELECT DISTINCT
          sr.scan_id,
          sr.hotel_id,
          COALESCE(h.name, 'Hotel ' || sr.hotel_id) AS hotel_name,
          sr.check_in_date
        FROM scan_results sr
        LEFT JOIN hotels h ON sr.hotel_id = h.id
        ${baseWhere}
      ),
      price_data AS (
        SELECT
          sr.scan_id,
          sr.hotel_id,
          sr.check_in_date,
          sr.source,
          CASE
            WHEN sr.response_json->'rooms' IS NOT NULL THEN
              (SELECT jsonb_agg(
                jsonb_build_object(
                  'room_name', COALESCE(room->>'name', room->>'roomName', room->>'room_name', room->>'title', room->>'type'),
                  'rate_name', rate->>'name',
                  'price', COALESCE((rate->>'actualPrice')::numeric, (rate->>'memberPrice')::numeric, (rate->>'price')::numeric),
                  'member_price', CASE
                    WHEN rate->>'basePrice' IS NOT NULL THEN (rate->>'basePrice')::numeric
                    WHEN rate->>'price' IS NOT NULL AND rate->>'memberPrice' IS NOT NULL THEN (rate->>'price')::numeric
                    ELSE NULL END,
                  'currency', rate->>'currency'
                )
              )
              FROM jsonb_array_elements(sr.response_json->'rooms') AS room,
                   jsonb_array_elements(room->'rates') AS rate
              WHERE COALESCE((rate->>'actualPrice')::numeric, (rate->>'memberPrice')::numeric, (rate->>'price')::numeric) IS NOT NULL)
            ELSE NULL
          END AS room_rates
        FROM scan_results sr
        ${priceWhere}
      ),
      min_prices AS (
        SELECT
          pd.scan_id,
          pd.hotel_id,
          pd.check_in_date,
          pd.source,
          MIN((rr->>'price')::numeric) AS min_price,
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
          ) AS min_rate_details
          -- note: 'price' in room_rates is already normalised to actualPrice above
        FROM price_data pd,
             jsonb_array_elements(COALESCE(pd.room_rates, '[]'::jsonb)) AS rr
        WHERE pd.room_rates IS NOT NULL
        GROUP BY pd.scan_id, pd.hotel_id, pd.check_in_date, pd.source, pd.room_rates
      )
      SELECT
        sb.scan_id,
        sb.hotel_id,
        sb.hotel_name,
        sb.check_in_date::text,
        MAX(CASE WHEN mp.source = 'amello' THEN mp.min_price END) AS amello_min_price,
        MAX(CASE WHEN mp.source = 'amello' THEN mp.min_rate_details->>'currency' END) AS amello_currency,
        MAX(CASE WHEN mp.source = 'amello' THEN mp.min_rate_details->>'room_name' END) AS amello_room_name,
        MAX(CASE WHEN mp.source = 'amello' THEN mp.min_rate_details->>'rate_name' END) AS amello_rate_name,
        MAX(CASE WHEN mp.source = 'booking' THEN mp.min_price END) AS booking_min_price,
        MAX(CASE WHEN mp.source = 'booking_member' THEN mp.min_price END) AS booking_member_min_price,
        MAX(CASE WHEN mp.source = 'booking' THEN mp.min_rate_details->>'currency' END) AS booking_currency,
        MAX(CASE WHEN mp.source = 'booking' THEN mp.min_rate_details->>'room_name' END) AS booking_room_name,
        MAX(CASE WHEN mp.source = 'booking' THEN mp.min_rate_details->>'rate_name' END) AS booking_rate_name,
        MAX(CASE WHEN mp.source = 'amello' THEN mp.min_price END) -
        MAX(CASE WHEN mp.source = 'booking' THEN mp.min_price END) AS price_difference,
        CASE
          WHEN MAX(CASE WHEN mp.source = 'booking' THEN mp.min_price END) > 0
          THEN (
            (MAX(CASE WHEN mp.source = 'amello' THEN mp.min_price END) -
             MAX(CASE WHEN mp.source = 'booking' THEN mp.min_price END)) /
             MAX(CASE WHEN mp.source = 'booking' THEN mp.min_price END) * 100
          )
          ELSE NULL
        END AS percentage_difference
      FROM scan_base sb
      LEFT JOIN min_prices mp
        ON mp.scan_id = sb.scan_id
       AND mp.hotel_id = sb.hotel_id
       AND mp.check_in_date = sb.check_in_date
      GROUP BY sb.scan_id, sb.hotel_id, sb.hotel_name, sb.check_in_date
      ORDER BY sb.scan_id DESC, sb.hotel_id, sb.check_in_date
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;

    const countQuery = `
      SELECT COUNT(DISTINCT (sr.scan_id, sr.hotel_id, sr.check_in_date))::int AS total
      FROM scan_results sr
      ${baseWhere}
    `;

    const [{ rows: dataRows }, { rows: countRows }] = await Promise.all([
      query<RateComparisonRow>(dataQuery, [...params, limit, offset]),
      query<{ total: number }>(countQuery, params),
    ]);

    return NextResponse.json({
      data: dataRows,
      total: countRows[0]?.total || 0,
      page,
      limit,
      totalPages: Math.ceil((countRows[0]?.total || 0) / limit),
    });
  } catch (e: any) {
    console.error('[GET /api/rate-comparison] error', e);
    return NextResponse.json(
      { error: e.message || 'Failed to fetch rate comparison data' },
      { status: 500 }
    );
  }
}
