import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* GET: fetch scan results with pagination and filtering */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    
    // Parse query parameters - use scanID instead of scanId for consistency
    const scanIDParam = searchParams.get('scanID');
    const statusParam = searchParams.get('status');
    const hotelIDParam = searchParams.get('hotelID');
    const checkInDateParam = searchParams.get('checkInDate');
    const sourceParam = searchParams.get('source');
    const formatParam = searchParams.get('format'); // 'comparison' for price comparison format
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100', 10)));
    const offset = (page - 1) * limit;

    const scanID = scanIDParam ? parseInt(scanIDParam, 10) : null;
    const status = statusParam && (statusParam === 'green' || statusParam === 'red') ? statusParam : null;
    const hotelID = hotelIDParam ? parseInt(hotelIDParam, 10) : null;
    const checkInDate = checkInDateParam || null;
    const source = sourceParam && (sourceParam === 'booking' || sourceParam === 'amello') ? sourceParam : null;

    // Build WHERE conditions dynamically
    const conditions: string[] = [];
    const params: (number | string)[] = [];
    let paramCount = 0;

    if (scanID !== null) {
      paramCount++;
      conditions.push(`sr.scan_id = $${paramCount}`);
      params.push(scanID);
    }
    if (status !== null) {
      paramCount++;
      conditions.push(`sr.status = $${paramCount}`);
      params.push(status);
    }
    if (hotelID !== null) {
      paramCount++;
      conditions.push(`sr.hotel_id = $${paramCount}`);
      params.push(hotelID);
    }
    if (checkInDate !== null) {
      paramCount++;
      conditions.push(`sr.check_in_date = $${paramCount}`);
      params.push(checkInDate);
    }
    if (source !== null) {
      paramCount++;
      conditions.push(`sr.source = $${paramCount}`);
      params.push(source);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Handle comparison format
    if (formatParam === 'comparison') {
      // For comparison format, we need to merge amello and booking results
      // Group by hotel_id, hotel_name, check_in_date, room_name, rate_name
      const comparisonQuery = `
        WITH extracted_data AS (
          SELECT 
            sr.scan_id,
            sr.hotel_id,
            h.name as hotel_name,
            sr.check_in_date,
            sr.source,
            sr.status,
            sr.response_json,
            CASE 
              WHEN sr.status = 'green' AND sr.response_json->'rooms' IS NOT NULL THEN
                (SELECT jsonb_agg(
                  jsonb_build_object(
                    'room_name', room->>'name',
                    'rate_name', rate->>'name',
                    'price', (rate->>'price')::numeric,
                    'currency', rate->>'currency'
                  )
                )
                FROM jsonb_array_elements(sr.response_json->'rooms') AS room,
                     jsonb_array_elements(room->'rates') AS rate)
              ELSE NULL
            END as room_rates
          FROM scan_results sr
          LEFT JOIN hotels h ON sr.hotel_id = h.id
          ${whereClause}
        ),
        flattened_data AS (
          SELECT 
            ed.scan_id,
            ed.hotel_id,
            ed.hotel_name,
            ed.check_in_date,
            ed.source,
            ed.status,
            rr->>'room_name' as room_name,
            rr->>'rate_name' as rate_name,
            (rr->>'price')::numeric as price,
            rr->>'currency' as currency
          FROM extracted_data ed,
               jsonb_array_elements(COALESCE(ed.room_rates, '[]'::jsonb)) AS rr
          WHERE ed.room_rates IS NOT NULL
        )
        SELECT 
          fd.hotel_id,
          fd.hotel_name,
          fd.check_in_date,
          fd.room_name,
          fd.rate_name,
          MAX(CASE WHEN fd.source = 'amello' THEN fd.price END) as price_amello,
          MAX(CASE WHEN fd.source = 'booking' THEN fd.price END) as price_booking,
          MAX(CASE WHEN fd.source = 'amello' THEN fd.status END) as status_amello,
          MAX(CASE WHEN fd.source = 'booking' THEN fd.status END) as status_booking,
          COALESCE(MAX(fd.currency), 'EUR') as currency
        FROM flattened_data fd
        GROUP BY fd.hotel_id, fd.hotel_name, fd.check_in_date, fd.room_name, fd.rate_name
        ORDER BY fd.hotel_id, fd.check_in_date, fd.room_name, fd.rate_name
        LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
      `;

      const { rows: comparisonRows } = await query(comparisonQuery, [...params, limit, offset]);

      // Count query for comparison format
      const countComparisonQuery = `
        WITH extracted_data AS (
          SELECT 
            sr.scan_id,
            sr.hotel_id,
            h.name as hotel_name,
            sr.check_in_date,
            sr.source,
            sr.status,
            sr.response_json,
            CASE 
              WHEN sr.status = 'green' AND sr.response_json->'rooms' IS NOT NULL THEN
                (SELECT jsonb_agg(
                  jsonb_build_object(
                    'room_name', room->>'name',
                    'rate_name', rate->>'name',
                    'price', (rate->>'price')::numeric,
                    'currency', rate->>'currency'
                  )
                )
                FROM jsonb_array_elements(sr.response_json->'rooms') AS room,
                     jsonb_array_elements(room->'rates') AS rate)
              ELSE NULL
            END as room_rates
          FROM scan_results sr
          LEFT JOIN hotels h ON sr.hotel_id = h.id
          ${whereClause}
        ),
        flattened_data AS (
          SELECT 
            ed.scan_id,
            ed.hotel_id,
            ed.hotel_name,
            ed.check_in_date,
            ed.source,
            ed.status,
            rr->>'room_name' as room_name,
            rr->>'rate_name' as rate_name,
            (rr->>'price')::numeric as price,
            rr->>'currency' as currency
          FROM extracted_data ed,
               jsonb_array_elements(COALESCE(ed.room_rates, '[]'::jsonb)) AS rr
          WHERE ed.room_rates IS NOT NULL
        )
        SELECT COUNT(DISTINCT (hotel_id, check_in_date, room_name, rate_name))::int as total
        FROM flattened_data
      `;
      
      const { rows: countComparisonRows } = await query(countComparisonQuery, params);
      const comparisonTotal = countComparisonRows[0]?.total || 0;

      return NextResponse.json({
        data: comparisonRows,
        total: comparisonTotal,
        page,
        limit,
        totalPages: Math.ceil(comparisonTotal / limit),
      });
    }

    // Build and execute count query with JOIN (for consistency with data query)
    const countQuery = `
      SELECT COUNT(*)::int AS total 
      FROM scan_results sr
      LEFT JOIN hotels h ON sr.hotel_id = h.id
      ${whereClause}
    `;
    const { rows: countRows } = await query<{ total: number }>(countQuery, params);
    const total = countRows[0]?.total || 0;

    // Build and execute data query with JOIN to get hotel name
    const dataQuery = `
      SELECT sr.scan_id, sr.hotel_id, h.name as hotel_name, sr.check_in_date, sr.status, sr.response_json, sr.source 
      FROM scan_results sr
      LEFT JOIN hotels h ON sr.hotel_id = h.id
      ${whereClause}
      ORDER BY sr.scan_id DESC 
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `;
    const { rows: dataRows } = await query(dataQuery, [...params, limit, offset]);

    return NextResponse.json({
      data: dataRows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (e: any) {
    console.error('[GET /api/scan-results] error', e);
    return NextResponse.json(
      { error: e.message || 'Failed to fetch scan results' },
      { status: 500 }
    );
  }
}
