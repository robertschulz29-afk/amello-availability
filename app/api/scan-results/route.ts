import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* GET: fetch scan results with pagination and filtering */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    
    // Parse query parameters
    const scanIdParam = searchParams.get('scanId');
    const statusParam = searchParams.get('status');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100', 10)));
    const offset = (page - 1) * limit;

    // Get total count with filters
    let total = 0;
    if (scanIdParam && statusParam) {
      const scanId = parseInt(scanIdParam, 10);
      const { rows: countRows } = await sql<{ total: number }>`
        SELECT COUNT(*)::int AS total 
        FROM scan_results 
        WHERE scan_id = ${scanId} AND status = ${statusParam}
      `;
      total = countRows[0]?.total || 0;
    } else if (scanIdParam) {
      const scanId = parseInt(scanIdParam, 10);
      const { rows: countRows } = await sql<{ total: number }>`
        SELECT COUNT(*)::int AS total 
        FROM scan_results 
        WHERE scan_id = ${scanId}
      `;
      total = countRows[0]?.total || 0;
    } else if (statusParam) {
      const { rows: countRows } = await sql<{ total: number }>`
        SELECT COUNT(*)::int AS total 
        FROM scan_results 
        WHERE status = ${statusParam}
      `;
      total = countRows[0]?.total || 0;
    } else {
      const { rows: countRows } = await sql<{ total: number }>`
        SELECT COUNT(*)::int AS total FROM scan_results
      `;
      total = countRows[0]?.total || 0;
    }

    // Get paginated data with filters
    let dataRows: any[] = [];
    if (scanIdParam && statusParam) {
      const scanId = parseInt(scanIdParam, 10);
      const { rows } = await sql`
        SELECT 
          id,
          scan_id,
          hotel_id,
          check_in_date,
          status,
          response_json
        FROM scan_results
        WHERE scan_id = ${scanId} AND status = ${statusParam}
        ORDER BY id DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      dataRows = rows;
    } else if (scanIdParam) {
      const scanId = parseInt(scanIdParam, 10);
      const { rows } = await sql`
        SELECT 
          id,
          scan_id,
          hotel_id,
          check_in_date,
          status,
          response_json
        FROM scan_results
        WHERE scan_id = ${scanId}
        ORDER BY id DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      dataRows = rows;
    } else if (statusParam) {
      const { rows } = await sql`
        SELECT 
          id,
          scan_id,
          hotel_id,
          check_in_date,
          status,
          response_json
        FROM scan_results
        WHERE status = ${statusParam}
        ORDER BY id DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      dataRows = rows;
    } else {
      const { rows } = await sql`
        SELECT 
          id,
          scan_id,
          hotel_id,
          check_in_date,
          status,
          response_json
        FROM scan_results
        ORDER BY id DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      dataRows = rows;
    }

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
