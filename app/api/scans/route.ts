// app/api/scans/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { DEFAULT_BELLO_MANDATOR } from '@/lib/constants';
import { ymdToUTC, toYMDUTC } from '@/lib/scrapers/process-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function berlinTodayYMD(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function getBaseUrl(): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

/**
 * Kicks off the first batch via the orchestrator without blocking scan creation response.
 */
function triggerFirstBatch(scanId: number, belloMandator: string): void {
  const url = `${getBaseUrl()}/api/scans/process`;

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Bello-Mandator': belloMandator,
    },
    body: JSON.stringify({ scanId, startIndex: 0, size: 50 }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('[scans] triggerFirstBatch failed:', res.status, text.slice(0, 200));
      } else {
        const result = await res.json().catch(() => ({}));
        console.log('[scans] triggerFirstBatch success — processed:', result.amello?.processed, '| done:', result.done);
      }
    })
    .catch((e) => console.error('[scans] triggerFirstBatch fetch error:', e.message));
}

/* GET: list scans */
export async function GET() {
  try {
    const { rows } = await sql`
      SELECT id, scanned_at, stay_nights, total_cells, done_cells, status
      FROM scans
      ORDER BY scanned_at DESC
      LIMIT 200
    `;
    return NextResponse.json(rows);
  } catch (e: any) {
    console.error('[GET /api/scans] error', e);
    return NextResponse.json({ error: 'failed to load scans' }, { status: 500 });
  }
}

/* POST: create a scan */
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const isCron = url.searchParams.get('cron') === '1' || url.searchParams.has('key');
    const belloMandator = req.headers.get('Bello-Mandator') || DEFAULT_BELLO_MANDATOR;
    const body = await req.json().catch(() => ({}));

    // baseCheckIn
    let baseCheckIn: string | null =
      typeof body?.baseCheckIn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.baseCheckIn)
        ? body.baseCheckIn
        : null;

    const berlinToday = berlinTodayYMD();
    if (!baseCheckIn) {
      const dt = ymdToUTC(berlinToday);
      dt.setUTCDate(dt.getUTCDate() + 5);
      baseCheckIn = toYMDUTC(dt);
    }

    const days: number =
      Number.isFinite(body?.days) && body.days >= 1 && body.days <= 365 ? Number(body.days) : 86;

    const stayNights: number =
      Number.isFinite(body?.stayNights) && body.stayNights >= 1 && body.stayNights <= 30
        ? Number(body.stayNights) : 7;

    const checkoutDt = ymdToUTC(baseCheckIn);
    checkoutDt.setUTCDate(checkoutDt.getUTCDate() + stayNights);
    const fixedCheckout = toYMDUTC(checkoutDt);

    const startOffset = 0;
    const endOffset = days - 1;

    // Cron idempotency
    if (isCron) {
      const already = await sql<{ id: number }>`
        SELECT id FROM scans
        WHERE (scanned_at AT TIME ZONE 'Europe/Berlin')::date = ${berlinToday}::date
          AND status IN ('queued','running','done')
        ORDER BY id DESC LIMIT 1
      `;
      if (already.rows.length > 0) {
        return NextResponse.json({ ok: true, message: 'already ran today', scanId: already.rows[0].id });
      }
    }

    const countQ = await sql<{ c: number }>`
      SELECT COUNT(*)::int AS c FROM hotels WHERE bookable = true AND active = true
    `;
    const hotelsCount = countQ.rows[0]?.c ?? 0;
    const totalCells = hotelsCount * days;

    const ins = await sql`
      INSERT INTO scans (
        fixed_checkout, start_offset, end_offset, stay_nights, timezone,
        total_cells, done_cells, status, base_checkin, days
      )
      VALUES (
        ${fixedCheckout}, ${startOffset}, ${endOffset}, ${stayNights}, 'Europe/Berlin',
        ${totalCells}, 0, 'running', ${baseCheckIn}, ${days}
      )
      RETURNING id, scanned_at
    `;

    const scanId = ins.rows[0].id as number;

    // Kick off first batch asynchronously — don't await
    triggerFirstBatch(scanId, belloMandator);

    return NextResponse.json({ scanId, totalCells, baseCheckIn, days, stayNights, fixedCheckout });

  } catch (e: any) {
    console.error('[POST /api/scans] error', e);
    return NextResponse.json({ error: e.message || 'failed to create scan' }, { status: 500 });
  }
}
