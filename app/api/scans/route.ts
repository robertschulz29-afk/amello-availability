import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL =
  process.env.AMELLO_BASE_URL || 'https://prod-api.amello.plusline.net/api/v1';

/** Format a UTC Date to 'YYYY-MM-DD' without timezone surprises */
function toYMDFromUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Get today's calendar date in Europe/Berlin as {y,m,d} via Intl (no parsing) */
function todayBerlin(): { y: number; m: number; d: number } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // 'en-CA' gives 'YYYY-MM-DD'
  const [y, m, d] = fmt.format(now).split('-').map((n) => Number(n));
  return { y, m, d };
}

/**
 * Build an inclusive list of Berlin calendar dates (YYYY-MM-DD),
 * from today+startOffset to today+endOffset.
 * No locale parsing; we advance a UTC date object to avoid DST pitfalls.
 */
function berlinDateRangeYMD(startOffset: number, endOffset: number): string[] {
  const { y, m, d } = todayBerlin();
  // Start from Berlin-today at midnight calendar-wise: represent it as UTC date
  const base = new Date(Date.UTC(y, m - 1, d));
  const out: string[] = [];
  for (let off = startOffset; off <= endOffset; off++) {
    const dt = new Date(base); // clone
    dt.setUTCDate(dt.getUTCDate() + off);
    out.push(toYMDFromUTC(dt));
  }
  return out;
}

export async function GET() {
  try {
    const { rows } = await sql`
      SELECT id, scanned_at, fixed_checkout, start_offset, end_offset, timezone
      FROM scans
      ORDER BY scanned_at DESC
    `;
    return NextResponse.json(rows);
  } catch (err: any) {
    console.error('[GET /api/scans] error:', err);
    return NextResponse.json({ error: 'DB error listing scans' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Read optional overrides; default to +5..+90 as discussed
    const txt = await req.text();
    let body: any = {};
    if (txt) {
      try {
        body = JSON.parse(txt);
      } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
      }
    }
    const { startOff
