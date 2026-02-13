import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { DEFAULT_BELLO_MANDATOR } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/scans/process-next
 * 
 * Processes the next batch of any running scan.
 * Intended to be called by a cron job to ensure scans complete even if
 * the initial trigger times out or fails.
 * 
 * This endpoint:
 * 1. Finds the oldest running scan with incomplete processing
 * 2. Processes the next batch (30 cells)
 * 3. Returns the processing result
 */
export async function POST(req: NextRequest) {
  try {
    // Find scans with status='running' and done_cells < total_cells
    const runningScans = await sql`
      SELECT id, done_cells, total_cells 
      FROM scans 
      WHERE status = 'running' 
        AND done_cells < total_cells
      ORDER BY scanned_at ASC
      LIMIT 1
    `;
    
    if (runningScans.rows.length === 0) {
      return NextResponse.json({ 
        message: 'No scans to process',
        processed: 0,
      });
    }
    
    const scan = runningScans.rows[0];
    const scanId = scan.id as number;
    const doneCells = scan.done_cells as number;
    
    console.log('[POST /api/scans/process-next] Processing scan', scanId, 'at index', doneCells);
    
    // Get the Bello-Mandator header, with fallback to default
    const belloMandator = req.headers.get('Bello-Mandator') || DEFAULT_BELLO_MANDATOR;
    
    // Determine the base URL for internal API calls
    const baseUrl = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    
    // Process next batch
    const response = await fetch(`${baseUrl}/api/scans/process`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Bello-Mandator': belloMandator,
      },
      body: JSON.stringify({ 
        scanId, 
        startIndex: doneCells, 
        size: 30 
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[POST /api/scans/process-next] Processing failed:', response.status, errorText);
      return NextResponse.json(
        { 
          error: 'Processing failed',
          status: response.status,
          details: errorText,
        },
        { status: 500 }
      );
    }
    
    const result = await response.json();
    
    console.log('[POST /api/scans/process-next] Processed', result.processed, 'cells for scan', scanId);
    
    return NextResponse.json({
      scanId,
      processed: result.processed || 0,
      nextIndex: result.nextIndex || doneCells,
      done: result.done || false,
      total: result.total || scan.total_cells,
    });
  } catch (e: any) {
    console.error('[POST /api/scans/process-next] Error:', e);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: e.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
