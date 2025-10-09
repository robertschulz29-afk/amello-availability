import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function ymdToUTC(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function toYMDUTC(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function berlinTodayYMD(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

export async function GET() {
  // list scans (unchanged)
  const { rows } = await sql`
    SELECT id, scanned_at, start_offset, end_offset, stay_nights, timezone, total_cells, done_cells, status,
           base_checkin, days
    FROM scans
    ORDER BY scanned_at DESC
    LIMIT 200
  `;
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const isCron = url.searchParams.get('cron') === '1' || url.searchParams.has('key');

    const body = await req.json().catch(() => ({}));
    // NEW configurable params
    const baseCheckIn: string | null =
      typeof body?.baseCheckIn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.baseCheckIn)
        ? body.baseCheckIn
        : null;

    const days: number =
      Number.isFinite(body?.days) && body.days >= 1 && body.days <= 365 ? Number(body.days) : 86;

    const stayNights: number =
      Number.isFinite(body?.stayNights) && body.stayNights >= 1 && body.stayNights <= 30
        ? Number(body.stayNights)
        : 7;

    // Backward-compat defaults if no baseCheckIn provided:
    const berlinToday = berlinTodayYMD();
    const effectiveBase = baseCheckIn ?? berlinToday; // you can change default to today+5 by computing here
    // If you want "default today+5":
    // const dt = ymdToUTC(berlinToday); dt.setUTCDate(dt.getUTCDate() + 5);
    // const effectiveBase = baseCheckIn ?? toYMDUTC(dt);

    // CRON idempotency (optional – as before)
    if (isCron) {
      const existing = await sql<{ id:number }>`
        SELECT id FROM scans
        WHERE (scanned_at AT TIME ZONE 'Europe/Berlin')::date = ${berlinToday}::date
          AND status IN ('queued','running','done')
        ORDER BY id DESC
        LIMIT 1
      `;
      if (existing.rows.length > 0) {
        return NextResponse.json({ ok: true, message: 'already ran today', scanId: existing.rows[0].id });
      }
    }

    const hotelsCount = Number((await sql`SELECT COUNT(*)::int AS c FROM hotels`).rows[0].c);
    const totalCells = hotelsCount * days;

    // Insert scan header
    const ins = await sql`
      INSERT INTO scans (fixed_checkout, start_offset, end_offset, stay_nights, timezone,
                         total_cells, done_cells, status, base_checkin, days)
      VALUES (NULL, NULL, NULL, ${stayNights}, 'Europe/Berlin',
              ${totalCells}, 0, 'running', ${effectiveBase}, ${days})
      RETURNING id, scanned_at
    `;
    const scanId = ins.rows[0].id as number;

    return NextResponse.json({
      scanId,
      totalCells,
      baseCheckIn: effectiveBase,
      days,
      stayNights,
    });
  } catch (e:any) {
    console.error('[POST /api/scans] error', e);
    return NextResponse.json({ error: 'failed to create scan' }, { status: 500 });
  }
}
