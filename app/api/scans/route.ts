import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { DEFAULT_BELLO_MANDATOR } from '@/lib/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* utils */
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
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

/**
 * Trigger the first batch of scan processing in the background
 * This kickstarts the scan without blocking the response
 */
async function processFirstBatch(scanId: number, belloMandator: string) {
  try {
    const baseUrl = process.env.NEXTAUTH_URL || 
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    
    const targetUrl = `${baseUrl}/api/scans/process`;
    
    console.log('[processFirstBatch] ==================== START ====================');
    console.log('[processFirstBatch] Scan ID:', scanId);
    console.log('[processFirstBatch] Base URL:', baseUrl);
    console.log('[processFirstBatch] Target URL:', targetUrl);
    console.log('[processFirstBatch] Bello-Mandator:', belloMandator);
    console.log('[processFirstBatch] NEXTAUTH_URL:', process.env.NEXTAUTH_URL || 'NOT SET');
    console.log('[processFirstBatch] VERCEL_URL:', process.env.VERCEL_URL || 'NOT SET');
    
    // Fire request and log result (don't await in caller)
    const fetchPromise = fetch(targetUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Bello-Mandator': belloMandator,
      },
      body: JSON.stringify({ 
        scanId, 
        startIndex: 0, 
        size: 30 
      }),
    });
    
    // Log result but don't block scan creation
    fetchPromise
      .then(async (response) => {
        console.log('[processFirstBatch] ===== RESPONSE RECEIVED =====');
        console.log('[processFirstBatch] Status:', response.status);
        console.log('[processFirstBatch] Status Text:', response.statusText);
        
        if (!response.ok) {
          const text = await response.text().catch(() => 'Could not read body');
          console.error('[processFirstBatch] ❌ REQUEST FAILED');
          console.error('[processFirstBatch] Status:', response.status);
          console.error('[processFirstBatch] Body:', text);
        } else {
          const result = await response.json().catch(() => ({ error: 'Could not parse JSON' }));
          console.log('[processFirstBatch] ✅ REQUEST SUCCESS');
          console.log('[processFirstBatch] Processed:', result.processed || 0);
          console.log('[processFirstBatch] Next Index:', result.nextIndex || 0);
          console.log('[processFirstBatch] Done:', result.done || false);
          console.log('[processFirstBatch] Total:', result.total || 0);
        }
        console.log('[processFirstBatch] ==================== END ====================');
      })
      .catch(e => {
        console.error('[processFirstBatch] ===== FETCH ERROR =====');
        console.error('[processFirstBatch] Error type:', e.name || 'Unknown');
        console.error('[processFirstBatch] Error message:', e.message || 'No message');
        console.error('[processFirstBatch] Error stack:', e.stack || 'No stack');
        console.error('[processFirstBatch] Scan will rely on cron job to continue');
        console.error('[processFirstBatch] ==================== END ====================');
      });
      
  } catch (e: unknown) {
    console.error('[processFirstBatch] ===== OUTER ERROR =====');
    console.error('[processFirstBatch] Error:', e);
    if (e instanceof Error) {
      console.error('[processFirstBatch] Message:', e.message);
      console.error('[processFirstBatch] Stack:', e.stack || 'No stack');
    } else {
      console.error('[processFirstBatch] Message:', String(e));
    }
  }
}

/* GET: list scans (robust: only minimal columns) */
export async function GET() {
  try {
    const { rows } = await sql`
      SELECT
        id,
        scanned_at,
        stay_nights,
        total_cells,
        done_cells,
        status
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

/* POST: create a scan (unchanged logic; populates legacy NOT NULL fields too) */
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const isCron = url.searchParams.get('cron') === '1' || url.searchParams.has('key');

    // Get the Bello-Mandator header for passing to process endpoint
    const belloMandator = req.headers.get('Bello-Mandator') || DEFAULT_BELLO_MANDATOR;

    const body = await req.json().catch(() => ({}));

    // baseCheckIn (YYYY-MM-DD). Default: Berlin today + 5 days.
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
      Number.isFinite(body?.days) && body.days >= 1 && body.days <= 365
        ? Number(body.days)
        : 86;

    const stayNights: number =
      Number.isFinite(body?.stayNights) && body.stayNights >= 1 && body.stayNights <= 30
        ? Number(body.stayNights)
        : 7;

    // Compute fixed_checkout (checkout for the first column)
    const checkoutDt = ymdToUTC(baseCheckIn);
    checkoutDt.setUTCDate(checkoutDt.getUTCDate() + stayNights);
    const fixedCheckout = toYMDUTC(checkoutDt);

    // Satisfy legacy NOT NULL constraints if present
    const startOffset = 0;
    const endOffset = days - 1;

    // Cron idempotency (optional)
    if (isCron) {
      const already = await sql<{ id: number }>`
        SELECT id
        FROM scans
        WHERE (scanned_at AT TIME ZONE 'Europe/Berlin')::date = ${berlinToday}::date
          AND status IN ('queued','running','done')
        ORDER BY id DESC
        LIMIT 1
      `;
      if (already.rows.length > 0) {
        return NextResponse.json({
          ok: true,
          message: 'already ran today',
          scanId: already.rows[0].id,
        });
      }
    }

    // Hotels count
    const countQ = await sql<{ c: number }>`SELECT COUNT(*)::int AS c FROM hotels`;
    const hotelsCount = countQ.rows[0]?.c ?? 0;
    const totalCells = hotelsCount * days;

    // Insert scan (providing legacy fields + new params)
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

    // Trigger first batch processing in the background
    // This kickstarts the scan without blocking the response
    processFirstBatch(scanId, belloMandator);

    return NextResponse.json({
      scanId,
      totalCells,
      baseCheckIn,
      days,
      stayNights,
      fixedCheckout,
      startOffset,
      endOffset,
    });
  } catch (e: any) {
    const msg = typeof e?.message === 'string' ? e.message : 'failed to create scan';
    console.error('[POST /api/scans] error', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
