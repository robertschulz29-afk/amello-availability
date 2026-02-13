import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { DEFAULT_BELLO_MANDATOR } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/scans/process-next
 * 
 * Processes the next batch of any running scan.
 * Called by Vercel cron job every minute (cron only supports GET).
 * 
 * This endpoint:
 * 1. Finds the oldest running scan with incomplete processing
 * 2. Processes the next batch (30 cells)
 * 3. Returns the processing result
 */
export async function GET(req: NextRequest) {
  return processNextScan(req);
}

/**
 * POST /api/scans/process-next
 * 
 * Same as GET but accessible via POST for manual testing/triggering.
 */
export async function POST(req: NextRequest) {
  return processNextScan(req);
}

/**
 * Shared logic for both GET and POST handlers
 */
async function processNextScan(req: NextRequest) {
  console.log('[process-next] ==================== CRON JOB INVOKED ====================');
  console.log('[process-next] Timestamp:', new Date().toISOString());
  
  try {
    // Find scans with status='running' and done_cells < total_cells
    // Now selecting up to 3 scans for parallel processing
    console.log('[process-next] Querying for running scans...');
    const runningScans = await sql`
      SELECT id, done_cells, total_cells 
      FROM scans 
      WHERE status = 'running' 
        AND done_cells < total_cells
      ORDER BY scanned_at ASC
      LIMIT 3
    `;
    
    console.log('[process-next] Query complete. Found:', runningScans.rows.length, 'scans');
    
    if (runningScans.rows.length === 0) {
      console.log('[process-next] ✓ No scans to process (all complete or none running)');
      return NextResponse.json({ 
        message: 'No scans to process',
        processed: 0,
      });
    }
    
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
    
    // Process all found scans in parallel using Promise.allSettled
    console.log('[process-next] ===== PARALLEL PROCESSING =====');
    console.log('[process-next] Processing', runningScans.rows.length, 'scans in parallel');
    
    const processingPromises = runningScans.rows.map(async (scan) => {
      const scanId = scan.id as number;
      const doneCells = scan.done_cells as number;
      const totalCells = scan.total_cells as number;
      
      console.log('[process-next] --- Processing Scan', scanId, '---');
      console.log('[process-next] Progress:', doneCells, '/', totalCells);
      console.log('[process-next] Remaining:', totalCells - doneCells, 'cells');
      
      // Process next batch with increased size (100 instead of 30)
      console.log('[process-next] Calling /api/scans/process for scan', scanId);
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Bello-Mandator': belloMandator,
        },
        body: JSON.stringify({ 
          scanId, 
          startIndex: doneCells, 
          size: 100 
        }),
      });
      
      console.log('[process-next] Response received for scan', scanId, ':', response.status, response.statusText);
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error('[process-next] ❌ PROCESSING FAILED for scan', scanId);
        console.error('[process-next] Status:', response.status);
        console.error('[process-next] Error:', errorText);
        throw new Error(`Processing failed for scan ${scanId}: ${errorText}`);
      }
      
      const result = await response.json();
      
      console.log('[process-next] --- Scan', scanId, 'Result ---');
      console.log('[process-next] Processed:', result.processed || 0, 'cells');
      console.log('[process-next] Failures:', result.failures || 0);
      console.log('[process-next] Next Index:', result.nextIndex || doneCells);
      console.log('[process-next] Done:', result.done ? 'YES' : 'NO');
      
      return {
        scanId,
        processed: result.processed || 0,
        nextIndex: result.nextIndex || doneCells,
        done: result.done || false,
        total: result.total || totalCells,
      };
    });
    
    const results = await Promise.allSettled(processingPromises);
    
    // Collect results
    const successfulScans = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map(r => r.value);
    const failedScans = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => ({ error: r.reason?.message || String(r.reason) }));
    
    console.log('[process-next] ===== PARALLEL PROCESSING COMPLETE =====');
    console.log('[process-next] Successful scans:', successfulScans.length);
    console.log('[process-next] Failed scans:', failedScans.length);
    console.log('[process-next] Total processed cells:', successfulScans.reduce((sum, s) => sum + s.processed, 0));
    console.log('[process-next] ==================== CRON JOB COMPLETE ====================');
    
    return NextResponse.json({
      scans: successfulScans,
      failures: failedScans,
      totalProcessed: successfulScans.reduce((sum, s) => sum + s.processed, 0),
      scansProcessed: successfulScans.length,
      scansFailed: failedScans.length,
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
