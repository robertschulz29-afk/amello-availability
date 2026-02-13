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
  console.log('[process-next] ==================== CRON JOB INVOKED ====================');
  console.log('[process-next] Timestamp:', new Date().toISOString());
  
  try {
    // Find scans with status='running' and done_cells < total_cells
    console.log('[process-next] Querying for running scans...');
    const runningScans = await sql`
      SELECT id, done_cells, total_cells 
      FROM scans 
      WHERE status = 'running' 
        AND done_cells < total_cells
      ORDER BY scanned_at ASC
      LIMIT 1
    `;
    
    console.log('[process-next] Query complete. Found:', runningScans.rows.length, 'scans');
    
    if (runningScans.rows.length === 0) {
      console.log('[process-next] ✓ No scans to process (all complete or none running)');
      return NextResponse.json({ 
        message: 'No scans to process',
        processed: 0,
      });
    }
    
    const scan = runningScans.rows[0];
    const scanId = scan.id as number;
    const doneCells = scan.done_cells as number;
    const totalCells = scan.total_cells as number;
    
    console.log('[process-next] ===== SCAN FOUND =====');
    console.log('[process-next] Scan ID:', scanId);
    console.log('[process-next] Progress:', doneCells, '/', totalCells);
    console.log('[process-next] Remaining:', totalCells - doneCells, 'cells');
    
    // Get the Bello-Mandator header, with fallback to default
    const belloMandator = req.headers.get('Bello-Mandator') || DEFAULT_BELLO_MANDATOR;
    console.log('[process-next] Bello-Mandator:', belloMandator);
    
    // Determine the base URL for internal API calls
    const baseUrl = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    const targetUrl = `${baseUrl}/api/scans/process`;
    
    console.log('[process-next] Base URL:', baseUrl);
    console.log('[process-next] Target URL:', targetUrl);
    console.log('[process-next] NEXTAUTH_URL:', process.env.NEXTAUTH_URL || 'NOT SET');
    console.log('[process-next] VERCEL_URL:', process.env.VERCEL_URL || 'NOT SET');
    
    // Process next batch
    console.log('[process-next] Calling /api/scans/process...');
    const response = await fetch(targetUrl, {
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
    
    console.log('[process-next] Response received:', response.status, response.statusText);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[process-next] ❌ PROCESSING FAILED');
      console.error('[process-next] Status:', response.status);
      console.error('[process-next] Error:', errorText);
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
    
    console.log('[process-next] ===== PROCESSING RESULT =====');
    console.log('[process-next] Processed:', result.processed || 0, 'cells');
    console.log('[process-next] Failures:', result.failures || 0);
    console.log('[process-next] Next Index:', result.nextIndex || doneCells);
    console.log('[process-next] Done:', result.done ? 'YES' : 'NO');
    console.log('[process-next] Total:', result.total || totalCells);
    console.log('[process-next] ==================== CRON JOB COMPLETE ====================');
    
    return NextResponse.json({
      scanId,
      processed: result.processed || 0,
      nextIndex: result.nextIndex || doneCells,
      done: result.done || false,
      total: result.total || totalCells,
    });
  } catch (e: unknown) {
    console.error('[process-next] ===== FATAL ERROR =====');
    if (e instanceof Error) {
      console.error('[process-next] Error type:', e.name);
      console.error('[process-next] Error message:', e.message);
      console.error('[process-next] Error stack:', e.stack || 'No stack trace');
    } else {
      console.error('[process-next] Error:', String(e));
    }
    console.error('[process-next] ==================== CRON JOB FAILED ====================');
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
