import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { QueryBuilder } from '@/lib/query-builder';
import { apiError } from '@/lib/api-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATUSES  = new Set(['green', 'red']);
const VALID_SOURCES   = new Set(['booking', 'booking_member', 'amello']);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const scanIDParam    = searchParams.get('scanID');
    const statusParam    = searchParams.get('status');
    const hotelIDParam   = searchParams.get('hotelID') ?? searchParams.get('hotelId');
    const checkInDateParam = searchParams.get('checkInDate');
    const sourceParam    = searchParams.get('source');
    const formatParam    = searchParams.get('format');
    const page  = Math.max(1, parseInt(searchParams.get('page')  || '1',   10));
    const maxLimit = formatParam === 'comparison' ? 5000 : 500;
    const limit = Math.min(maxLimit, Math.max(1, parseInt(searchParams.get('limit') || '100', 10)));
    const offset = (page - 1) * limit;

    const scanID     = scanIDParam  ? parseInt(scanIDParam,  10) : null;
    const status     = statusParam  && VALID_STATUSES.has(statusParam)  ? statusParam  : null;
    const source     = sourceParam  && VALID_SOURCES.has(sourceParam)   ? sourceParam  : null;
    const checkInDate = checkInDateParam || null;
    const hotelIDs  = hotelIDParam
      ? hotelIDParam.split(',').map(s => parseInt(s.trim(), 10)).filter(n => isFinite(n))
      : [];

    const qb = new QueryBuilder();
    qb.add('sr.scan_id = ?',        scanID)
      .add('sr.status = ?',         status)
      .addIn('sr.hotel_id',         hotelIDs)
      .add('sr.check_in_date = ?',  checkInDate)
      .add('sr.source = ?',         source);

    const { where, params } = qb.build();
    const pc = qb.paramCount;

    if (formatParam === 'comparison') {
      const extractCte = `
        WITH extracted_data AS (
          SELECT
            sr.scan_id, sr.hotel_id,
            h.name AS hotel_name,
            sr.check_in_date::text AS check_in_date,
            sr.source, sr.status,
            CASE
              WHEN sr.status = 'green' AND sr.response_json->'rooms' IS NOT NULL THEN (
                SELECT jsonb_agg(jsonb_build_object(
                  'room_name', room->>'name',
                  'rate_name', rate->>'name',
                  'price',     (rate->>'actualPrice')::numeric,
                  'currency',  rate->>'currency'
                ))
                FROM jsonb_array_elements(sr.response_json->'rooms') AS room,
                     jsonb_array_elements(room->'rates')              AS rate
              )
              ELSE NULL
            END AS room_rates
          FROM scan_results sr
          LEFT JOIN hotels h ON sr.hotel_id = h.id
          ${where}
        ),
        flattened_data AS (
          SELECT ed.scan_id, ed.hotel_id, ed.hotel_name, ed.check_in_date, ed.source,
                 rr->>'room_name'      AS room_name,
                 rr->>'rate_name'      AS rate_name,
                 (rr->>'price')::numeric AS price,
                 rr->>'currency'       AS currency
          FROM extracted_data ed,
               jsonb_array_elements(COALESCE(ed.room_rates, '[]'::jsonb)) AS rr
          WHERE ed.room_rates IS NOT NULL
        )`;

      const dataQuery = `${extractCte}
        SELECT
          hotel_id, hotel_name, check_in_date, room_name, rate_name,
          MAX(CASE WHEN source = 'amello'          THEN price END) AS price_amello,
          MAX(CASE WHEN source = 'booking'         THEN price END) AS price_booking,
          MAX(CASE WHEN source = 'booking_member'  THEN price END) AS price_booking_member,
          MAX(CASE WHEN source = 'amello'          THEN status END) AS status_amello,
          MAX(CASE WHEN source IN ('booking','booking_member') THEN status END) AS status_booking,
          COALESCE(MAX(currency), 'EUR') AS currency
        FROM flattened_data
        GROUP BY hotel_id, hotel_name, check_in_date, room_name, rate_name
        ORDER BY hotel_id, check_in_date, room_name, rate_name
        LIMIT $${pc + 1} OFFSET $${pc + 2}`;

      const countQuery = `${extractCte}
        SELECT COUNT(DISTINCT (hotel_id, check_in_date, room_name, rate_name))::int AS total
        FROM flattened_data`;

      const [{ rows: dataRows }, { rows: countRows }] = await Promise.all([
        query(dataQuery, [...params, limit, offset]),
        query(countQuery, params),
      ]);

      return NextResponse.json({
        data: dataRows,
        total: countRows[0]?.total || 0,
        page, limit,
        totalPages: Math.ceil((countRows[0]?.total || 0) / limit),
      });
    }

    const [{ rows: countRows }, { rows: dataRows }] = await Promise.all([
      query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM scan_results sr LEFT JOIN hotels h ON sr.hotel_id = h.id ${where}`,
        params,
      ),
      query(
        `SELECT sr.scan_id, sr.hotel_id, h.name AS hotel_name,
                h.booking_url, h.tuiamello_url, h.code AS hotel_code,
                sr.check_in_date::text AS check_in_date, sr.status, sr.response_json, sr.source
         FROM scan_results sr
         LEFT JOIN hotels h ON sr.hotel_id = h.id
         ${where}
         ORDER BY sr.scan_id DESC
         LIMIT $${pc + 1} OFFSET $${pc + 2}`,
        [...params, limit, offset],
      ),
    ]);

    return NextResponse.json({
      data: dataRows,
      total: countRows[0]?.total || 0,
      page, limit,
      totalPages: Math.ceil((countRows[0]?.total || 0) / limit),
    });
  } catch (e) {
    return apiError('[GET /api/scan-results]', e);
  }
}
