// app/api/scrape-health/route.ts
// API endpoint for fetching daily scrape health metrics

import { NextRequest, NextResponse } from 'next/server';
import { getDailyMetrics, getTopFailureReasons } from '@/lib/scrapers/utils/scrape-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/scrape-health
 * Get daily health metrics for the last N days
 * 
 * Query params:
 * - days: Number of days to look back (default: 7, max: 30)
 * - scan_id: Optional scan ID for failure reasons
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    
    const days = Math.min(
      parseInt(searchParams.get('days') || '7'),
      30
    );
    const scanId = searchParams.get('scan_id');

    const dailyMetrics = await getDailyMetrics(days);
    const failureReasons = await getTopFailureReasons(
      scanId ? parseInt(scanId) : undefined,
      10
    );

    return NextResponse.json({
      daily_metrics: dailyMetrics,
      failure_reasons: failureReasons,
      days,
    });
  } catch (error: any) {
    console.error('[GET /api/scrape-health] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch scrape health' },
      { status: 500 }
    );
  }
}
