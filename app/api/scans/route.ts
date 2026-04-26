// app/api/scans/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { sql, query } from '@/lib/db';
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

// Fire-and-forget: kick off processing for a specific source job
function triggerSourceJob(jobId: number, belloMandator: string, source: string): void {
  const url = `${getBaseUrl()}/api/scans/process/${source}`;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Bello-Mandator': belloMandator },
    body: JSON.stringify({ jobId, startIndex: 0, size: 50 }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`[scans] triggerSourceJob(${source}) failed:`, res.status, text.slice(0, 200));
      } else {
        const result = await res.json().catch(() => ({}));
        console.log(`[scans] triggerSourceJob(${source}) ok — done:`, result.done);
      }
    })
    .catch((e) => console.error(`[scans] triggerSourceJob(${source}) error:`, e.message));
}

/* GET: list scans with per-source job summary */
export async function GET() {
  try {
    const { rows } = await sql`
      SELECT
        s.id, s.scanned_at, s.base_checkin::text AS base_checkin,
        s.fixed_checkout::text AS fixed_checkout,
        s.days, s.stay_nights, s.timezone,
        s.total_cells, s.done_cells, s.status, s.sources,
        COALESCE(
          json_agg(
            json_build_object(
              'id', j.id,
              'source', j.source,
              'total_cells', j.total_cells,
              'done_cells', j.done_cells,
              'status', j.status
            ) ORDER BY j.source
          ) FILTER (WHERE j.id IS NOT NULL),
          '[]'::json
        ) AS source_jobs
      FROM scans s
      LEFT JOIN scan_source_jobs j ON j.scan_id = s.id
      GROUP BY s.id
      ORDER BY s.scanned_at DESC
      LIMIT 200
    `;
    return NextResponse.json(rows);
  } catch (e: any) {
    console.error('[GET /api/scans] error', e);
    return NextResponse.json({ error: 'failed to load scans' }, { status: 500 });
  }
}

/* POST: create a scan and one source job per enabled source */
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const isCron = url.searchParams.get('cron') === '1' || url.searchParams.has('key');
    const belloMandator = req.headers.get('Bello-Mandator') || DEFAULT_BELLO_MANDATOR;
    const body = await req.json().catch(() => ({}));

    // ── Resolve sources ───────────────────────────────────────────────────────
    let enabledSources: string[];

    if (Array.isArray(body?.sources)) {
      enabledSources = (body.sources as any[]).filter((s): s is string => typeof s === 'string');
      if (enabledSources.length === 0) {
        return NextResponse.json({ error: 'Select at least one source to start a scan.' }, { status: 400 });
      }
    } else {
      // Cron / legacy caller — read enabled sources from DB
      const sourcesQ = await sql`SELECT name FROM scan_sources WHERE enabled = true ORDER BY name`;
      enabledSources = sourcesQ.rows.map((r: any) => r.name as string);
      if (enabledSources.length === 0) {
        return NextResponse.json({ error: 'No scan sources are currently enabled.' }, { status: 400 });
      }
    }

    console.log('[scans] Creating scan with sources:', enabledSources);

    // ── Dates ─────────────────────────────────────────────────────────────────
    let baseCheckIn: string | null =
      typeof body?.baseCheckIn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.baseCheckIn)
        ? body.baseCheckIn : null;

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

    // ── Count hotels per source ───────────────────────────────────────────────
    const [allHotelsQ, bookingHotelsQ] = await Promise.all([
      sql<{ c: number }>`SELECT COUNT(*)::int AS c FROM hotels WHERE bookable = true AND active = true`,
      sql<{ c: number }>`SELECT COUNT(*)::int AS c FROM hotels WHERE bookable = true AND active = true AND booking_url IS NOT NULL AND booking_url != ''`,
    ]);
    const allHotelsCount    = allHotelsQ.rows[0]?.c ?? 0;
    const bookingHotelCount = bookingHotelsQ.rows[0]?.c ?? 0;

    function totalForSource(source: string): number {
      if (source === 'booking') return bookingHotelCount * days;
      return allHotelsCount * days; // amello and any future sources
    }

    // Legacy shared counters (sum across sources for backward compat display)
    const totalCells = enabledSources.reduce((sum, src) => sum + totalForSource(src), 0);
    const sourcesJson = JSON.stringify(enabledSources);

    // ── Create scan ───────────────────────────────────────────────────────────
    const ins = await sql`
      INSERT INTO scans (
        fixed_checkout, start_offset, end_offset, stay_nights, timezone,
        total_cells, done_cells, status, base_checkin, days, sources
      )
      VALUES (
        ${fixedCheckout}, 0, ${days - 1}, ${stayNights}, 'Europe/Berlin',
        ${totalCells}, 0, 'running', ${baseCheckIn}, ${days}, ${sourcesJson}::jsonb
      )
      RETURNING id
    `;
    const scanId = ins.rows[0].id as number;

    // ── Snapshot hotels at scan creation time ─────────────────────────────────
    await query(
      `INSERT INTO scan_hotels (scan_id, hotel_id, name, code, brand, region, country, bookable, active)
       SELECT $1, id, name, code, brand, region, country, bookable, active FROM hotels
       WHERE bookable = true AND active = true
       ON CONFLICT (scan_id, hotel_id) DO NOTHING`,
      [scanId],
    );

    // ── Create one source job per enabled source ──────────────────────────────
    const jobs: Array<{ jobId: number; source: string }> = [];
    for (const source of enabledSources) {
      const cells = totalForSource(source);
      const jobIns = await sql`
        INSERT INTO scan_source_jobs (scan_id, source, total_cells, done_cells, status)
        VALUES (${scanId}, ${source}, ${cells}, 0, 'running')
        ON CONFLICT (scan_id, source) DO UPDATE
          SET total_cells = EXCLUDED.total_cells, status = 'running', updated_at = NOW()
        RETURNING id
      `;
      const jobId = jobIns.rows[0].id as number;
      jobs.push({ jobId, source });
      console.log(`[scans] Created source job #${jobId} for scan #${scanId} source=${source} cells=${cells}`);
    }

    // ── Trigger first batch per source ────────────────────────────────────────
    for (const { jobId, source } of jobs) {
      triggerSourceJob(jobId, belloMandator, source);
    }

    return NextResponse.json({
      scanId, totalCells, baseCheckIn, days, stayNights, fixedCheckout,
      sources: enabledSources,
      sourceJobs: jobs,
    });

  } catch (e: any) {
    console.error('[POST /api/scans] error', e);
    return NextResponse.json({ error: e.message || 'failed to create scan' }, { status: 500 });
  }
}
