// app/api/scrape-logs/route.ts
// API endpoint for fetching scrape logs

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/scrape-logs
 * Fetch scrape logs with optional filters
 * 
 * Query params:
 * - scan_id: Filter by scan ID
 * - hotel_id: Filter by hotel ID
 * - status: Filter by scrape status
 * - limit: Number of records to return (default: 100, max: 1000)
 * - offset: Pagination offset (default: 0)
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    
    const scanId = searchParams.get('scan_id');
    const hotelId = searchParams.get('hotel_id');
    const status = searchParams.get('status');
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '100'),
      1000
    );
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build query with filters
    let queryText = `
      SELECT 
        id,
        timestamp,
        scan_id,
        hotel_id,
        hotel_name,
        scrape_status,
        http_status,
        delay_ms,
        retry_count,
        error_message,
        user_agent,
        reason,
        response_time_ms,
        session_id,
        url,
        check_in_date,
        created_at
      FROM scrape_logs
      WHERE 1=1
    `;
    
    const values: any[] = [];
    let paramIndex = 1;

    if (scanId) {
      queryText += ` AND scan_id = $${paramIndex}`;
      values.push(parseInt(scanId));
      paramIndex++;
    }

    if (hotelId) {
      queryText += ` AND hotel_id = $${paramIndex}`;
      values.push(parseInt(hotelId));
      paramIndex++;
    }

    if (status) {
      queryText += ` AND scrape_status = $${paramIndex}`;
      values.push(status);
      paramIndex++;
    }

    queryText += ` ORDER BY timestamp DESC`;
    queryText += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    values.push(limit, offset);

    const result = await query(queryText, values);

    return NextResponse.json({
      logs: result.rows,
      count: result.rows.length,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error('[GET /api/scrape-logs] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch scrape logs' },
      { status: 500 }
    );
  }
}
