// app/api/scrape-metrics/route.ts
// API endpoint for fetching aggregated scrape metrics

import { NextRequest, NextResponse } from 'next/server';
import { getScrapeMetrics, alertOnThresholds } from '@/lib/scrapers/utils/scrape-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/scrape-metrics
 * Get aggregated metrics for a scan
 * 
 * Query params:
 * - scan_id: Scan ID (required)
 * - check_thresholds: If true, check and log alerts (default: false)
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    
    const scanId = searchParams.get('scan_id');
    const checkThresholds = searchParams.get('check_thresholds') === 'true';

    if (!scanId) {
      return NextResponse.json(
        { error: 'scan_id is required' },
        { status: 400 }
      );
    }

    const metrics = await getScrapeMetrics(parseInt(scanId));

    // Optionally check thresholds and alert
    if (checkThresholds) {
      await alertOnThresholds(parseInt(scanId));
    }

    return NextResponse.json(metrics);
  } catch (error: any) {
    console.error('[GET /api/scrape-metrics] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch scrape metrics' },
      { status: 500 }
    );
  }
}
