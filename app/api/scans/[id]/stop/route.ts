import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/scans/[id]/stop
 * Stops a running scan by updating its status to 'cancelled'
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scanId = Number(params.id);
    
    if (!Number.isFinite(scanId) || scanId <= 0) {
      return NextResponse.json({ error: 'Invalid scan ID' }, { status: 400 });
    }

    // Check if scan exists and is in a stoppable state
    const scanResult = await sql`
      SELECT id, status
      FROM scans
      WHERE id = ${scanId}
    `;

    if (scanResult.rows.length === 0) {
      return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
    }

    const scan = scanResult.rows[0];
    
    // Only allow stopping scans that are queued or running
    if (scan.status !== 'queued' && scan.status !== 'running') {
      return NextResponse.json(
        { error: `Cannot stop scan with status: ${scan.status}` },
        { status: 400 }
      );
    }

    // Update scan status to cancelled
    await sql`
      UPDATE scans
      SET status = 'cancelled'
      WHERE id = ${scanId}
    `;

    return NextResponse.json({
      success: true,
      scanId,
      message: 'Scan stopped successfully',
    });
  } catch (e: any) {
    console.error('[POST /api/scans/[id]/stop] error', e);
    return NextResponse.json(
      { error: e?.message || 'Failed to stop scan' },
      { status: 500 }
    );
  }
}
