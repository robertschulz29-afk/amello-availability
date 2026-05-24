import { NextRequest, NextResponse } from 'next/server';
import { sql, query } from '@/lib/db';
import { runChunk } from '@/lib/playwright-scan-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) { return processNext(req); }
export async function POST(req: NextRequest) { return processNext(req); }

async function processNext(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[playwright-process-next] cron tick', new Date().toISOString());

  try {
    const scanQ = await sql`
      SELECT id, check_in, take_screenshot, retry_attempted
      FROM playwright_scans
      WHERE status = 'running'
      ORDER BY id ASC
      LIMIT 1
    `;

    if (scanQ.rows.length === 0) {
      return NextResponse.json({ message: 'No running playwright scans' });
    }

    const scan = scanQ.rows[0];
    const scanId: number = scan.id;
    const takeScreenshot: boolean = scan.take_screenshot ?? false;
    const retryAttempted: boolean = scan.retry_attempted ?? false;

    // Acquire lock: only proceed if no active lock (or lock expired)
    const lockResult = await sql`
      UPDATE playwright_scans
      SET locked_until = NOW() + INTERVAL '4 minutes'
      WHERE id = ${scanId}
        AND (locked_until IS NULL OR locked_until < NOW())
      RETURNING id
    `;
    if (lockResult.rows.length === 0) {
      console.log(`[playwright-process-next] scan=${scanId} locked, skipping tick`);
      return NextResponse.json({ message: 'Locked by another invocation', scanId });
    }

    const totalQ = await query(
      `SELECT COUNT(*)::int AS cnt FROM hotels WHERE active = true AND bookable = true`,
      [],
    );
    const total: number = totalQ.rows[0].cnt;

    const deadline = Date.now() + 240_000; // stop looping with 60s to spare before maxDuration
    let chunksRun = 0;
    let lastResult: any = null;

    // ── Main pass ──────────────────────────────────────────────────────────────
    while (Date.now() < deadline) {
      const offsetQ = await query(
        `SELECT COUNT(DISTINCT hotel_id)::int AS cnt FROM playwright_scan_results WHERE scan_id = $1`,
        [scanId],
      );
      const offset: number = offsetQ.rows[0].cnt;

      if (offset >= total) {
        // Main pass complete — check for errors before marking done
        if (!retryAttempted) {
          const errorQ = await query(
            `SELECT DISTINCT hotel_id FROM playwright_scan_results WHERE scan_id = $1 AND error IS NOT NULL`,
            [scanId],
          );
          const errorHotelIds: number[] = errorQ.rows.map((r: { hotel_id: number }) => r.hotel_id);

          if (errorHotelIds.length > 0) {
            console.log(`[playwright-process-next] scan=${scanId} main pass done, retrying ${errorHotelIds.length} errored hotels`);
            await sql`UPDATE playwright_scans SET retry_attempted = TRUE WHERE id = ${scanId}`;

            // ── Retry pass ───────────────────────────────────────────────────
            let retryOffset = 0;
            while (Date.now() < deadline) {
              if (retryOffset >= errorHotelIds.length) break;
              console.log(`[playwright-process-next] scan=${scanId} retry offset=${retryOffset}/${errorHotelIds.length}`);
              lastResult = await runChunk({ scanId, offset: retryOffset, takeScreenshot, hotelIds: errorHotelIds });
              chunksRun++;
              retryOffset += 3; // CHUNK_SIZE
              if (lastResult.aborted) break;
            }

            if (retryOffset >= errorHotelIds.length) {
              await sql`UPDATE playwright_scans SET status = 'done', finished_at = NOW(), locked_until = NULL WHERE id = ${scanId}`;
              return NextResponse.json({ message: 'Scan complete (with retry)', scanId, chunksRun });
            }
            // Retry not finished in this tick — release lock and let next tick continue
            break;
          }
        }

        await sql`UPDATE playwright_scans SET status = 'done', finished_at = NOW(), locked_until = NULL WHERE id = ${scanId}`;
        return NextResponse.json({ message: 'Scan complete', scanId, chunksRun });
      }

      console.log(`[playwright-process-next] scan=${scanId} offset=${offset}/${total}`);
      lastResult = await runChunk({ scanId, offset, takeScreenshot });
      chunksRun++;

      if (lastResult.done || lastResult.aborted) break;
    }

    // Handle retry pass resumption across cron ticks
    if (retryAttempted) {
      const remainingQ = await query(
        `SELECT DISTINCT hotel_id FROM playwright_scan_results WHERE scan_id = $1 AND error IS NOT NULL`,
        [scanId],
      );
      const remaining: number[] = remainingQ.rows.map((r: { hotel_id: number }) => r.hotel_id);

      if (remaining.length === 0) {
        await sql`UPDATE playwright_scans SET status = 'done', finished_at = NOW(), locked_until = NULL WHERE id = ${scanId}`;
        return NextResponse.json({ message: 'Scan complete (retry finished)', scanId, chunksRun });
      }

      // Still hotels left to retry — keep running
      let retryOffset = 0;
      while (Date.now() < deadline) {
        if (retryOffset >= remaining.length) break;
        console.log(`[playwright-process-next] scan=${scanId} retry (resumed) offset=${retryOffset}/${remaining.length}`);
        lastResult = await runChunk({ scanId, offset: retryOffset, takeScreenshot, hotelIds: remaining });
        chunksRun++;
        retryOffset += 3;
        if (lastResult.aborted) break;
      }

      if (retryOffset >= remaining.length) {
        await sql`UPDATE playwright_scans SET status = 'done', finished_at = NOW(), locked_until = NULL WHERE id = ${scanId}`;
        return NextResponse.json({ message: 'Scan complete (retry finished)', scanId, chunksRun });
      }
    }

    // Release lock so next cron tick can proceed immediately
    await sql`UPDATE playwright_scans SET locked_until = NULL WHERE id = ${scanId}`.catch(() => {});

    return NextResponse.json({ scanId, total, chunksRun, ...lastResult });

  } catch (e: any) {
    console.error('[playwright-process-next] fatal', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
