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
    const params: any[] = [];
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

    // Build and execute count query with JOIN
    const countQuery = `SELECT COUNT(*)::int AS total FROM scan_results sr ${whereClause}`;
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
