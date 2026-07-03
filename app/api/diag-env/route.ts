import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Disabled in production — exposes infrastructure details.
  // Use DIAG_SECRET bearer token for access in non-production environments.
  const diagSecret = process.env.DIAG_SECRET;
  if (diagSecret && req.headers.get('authorization') !== `Bearer ${diagSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!diagSecret && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  return NextResponse.json({
    DATABASE_URL: process.env.DATABASE_URL ? 'set' : 'missing',
    POSTGRES_URL: process.env.POSTGRES_URL ? 'set' : 'missing',
    SESSION_SECRET: process.env.SESSION_SECRET ? 'set' : 'missing',
    CRON_SECRET: process.env.CRON_SECRET ? 'set' : 'missing',
    SCRAPINGANT_API_KEY: process.env.SCRAPINGANT_API_KEY ? 'set' : 'missing',
  });
}
