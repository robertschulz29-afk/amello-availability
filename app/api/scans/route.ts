// app/api/scans/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function berlinTodayYMD(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date()); // 'YYYY-MM-DD'
}
function toYMDUTC(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function addDaysYMD(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toYMDUTC(dt);
}

export async function GET() {
  try {
    const { rows } = await sql`
      SELECT id, scanned_at, start_offset, end_offset, stay_nights,
             total_cells, done_cells, status
      FROM scans
      ORDER BY scanned_at DESC
    `;
    return NextResponse.json(rows);
  } catch (e:any) {
    console.error('[GET /api/scans] error', e);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const txt = await req.text();
    let body: any = {};
    if (txt) { try { body = JSON.parse(txt); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); } }
    const startOffset = Number.isFinite(body?.startOffset) ? body.startOffset : 5;
    const endOffset   = Number.isFinite(body?.endOffset)   ? body.endOffset   : 90;
    const stayNights  = Number.isFinite(body?.stayNights)  ? body.stayNights  : 7;

    if (endOffset < startOffset) return NextResponse.json({ error: 'endOffset must be >= startOffset' }, { status: 400 });
    if (stayNights <= 0) return NextResponse.json({ error: 'stayNights must be > 0' }, { status: 400 });

    // Count hotels now to compute total_cells
    const hotelsCount = Number((await sql`SELECT COUNT(*)::int AS c FROM hotels`).rows[0].c);
    const numDates = (endOffset - startOffset + 1);
    const totalCells = hotelsCount * numDates;

    // Store a placeholder fixed_checkout (first col’s checkout) to satisfy NOT NULL
    const firstCheckIn = addDaysYMD(berlinTodayYMD(), startOffset);
    const fixedCheckout = addDaysYMD(firstCheckIn, stayNights);

    const ins = await sql`
      INSERT INTO scans (fixed_checkout, start_offset, end_offset, stay_nights,
                         timezone, total_cells, done_cells, status)
      VALUES (${fixedCheckout}, ${startOffset}, ${endOffset}, ${stayNights},
              'Europe/Berlin', ${totalCells}, 0, 'running')
      RETURNING id, scanned_at, total_cells, done_cells, status
    `;
    const scan = ins.rows[0];

    return NextResponse.json({
      scanId: scan.id,
      scannedAt: scan.scanned_at,
      totalCells: scan.total_cells,
      doneCells: scan.done_cells,
      status: scan.status,
      startOffset, endOffset, stayNights,
    });
  } catch (e:any) {
    console.error('[POST /api/scans] error', e);
    return NextResponse.json({ error: 'Failed to create scan' }, { status: 500 });
  }
}
