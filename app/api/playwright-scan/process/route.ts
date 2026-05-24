import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { query, sql } from '@/lib/db';
import { createClient } from '@supabase/supabase-js';
import {
  OCCUPANCY_CONFIGS, ROOM_ITEM_SELECTOR, ROOM_NAME_SELECTOR, IMAGE_CONTAINER_SELECTOR,
  buildHotelSlug, buildTuiUrl,
} from '@/lib/playwright-scan-helpers';

function resolveAppUrl(req: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}`;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CHUNK_SIZE = 1;

let chromiumPath: string | undefined;

async function getChromiumPath(): Promise<string> {
  if (chromiumPath) return chromiumPath;
  const chromium = (await import('@sparticuz/chromium-min')).default;
  const CHROMIUM_URL = 'https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar';
  chromiumPath = await chromium.executablePath(CHROMIUM_URL);
  return chromiumPath;
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const scanId         = Number(body?.scanId);
  const offset         = Number.isFinite(body?.offset) ? Number(body.offset) : 0;
  const takeScreenshot: boolean = body?.takeScreenshot === true;
  const appUrl: string = body?.appUrl ?? resolveAppUrl(req);

  if (!Number.isFinite(scanId) || scanId <= 0) {
    return NextResponse.json({ error: 'invalid scanId' }, { status: 400 });
  }

  try {
    return await runChunk({ scanId, offset, takeScreenshot, appUrl });
  } catch (e: any) {
    console.error('[process] unhandled error', e.message);
    await sql`UPDATE playwright_scans SET status = 'failed', finished_at = NOW() WHERE id = ${scanId}`.catch(() => {});
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

async function runChunk({ scanId, offset, takeScreenshot, appUrl }: {
  scanId: number; offset: number; takeScreenshot: boolean; appUrl: string;
}): Promise<NextResponse> {

  const scanQ = await sql`SELECT status, check_in FROM playwright_scans WHERE id = ${scanId}`;
  if (!scanQ.rows.length) return NextResponse.json({ error: 'scan not found' }, { status: 404 });
  const scan = scanQ.rows[0];
  if (scan.status !== 'running') {
    return NextResponse.json({ skipped: true, reason: scan.status });
  }
  const checkIn: string = typeof scan.check_in === 'string'
    ? scan.check_in.slice(0, 10)
    : new Date(scan.check_in).toISOString().slice(0, 10);

  const hotelsQ = await query(
    `SELECT id, name, code FROM hotels WHERE active = true AND bookable = true ORDER BY id LIMIT $1 OFFSET $2`,
    [CHUNK_SIZE, offset],
  );
  const hotels = hotelsQ.rows as Array<{ id: number; name: string; code: string }>;

  const totalHotelsQ = await query(
    `SELECT COUNT(*)::int AS cnt FROM hotels WHERE active = true AND bookable = true`,
    [],
  );
  const totalHotels: number = totalHotelsQ.rows[0].cnt;

  let chunkProcessed = 0;
  let chunkErrors    = 0;

  const executablePath = await getChromiumPath();
  const puppeteer = (await import('puppeteer-core')).default;
  const supabase = takeScreenshot ? getSupabaseClient() : null;

  for (const hotel of hotels) {
    const slug = buildHotelSlug(hotel.name, hotel.code);
    let browser: any = null;
    let page: any = null;

    try {
      browser = await puppeteer.launch({
        executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'],
        headless: true,
      });

      // One page reused across all occupancy configs (matches original approach)
      page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });

      for (const cfg of OCCUPANCY_CONFIGS) {
        const url = buildTuiUrl(slug, checkIn, cfg.param);
        let rooms: Array<{ roomId: string; roomCode: string; roomName: string; imageMissing: boolean }> = [];
        let screenshotUrl: string | null = null;
        let errorMsg: string | null = null;

        try {
          try {
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
          } catch {
            // partial load — still attempt extraction
          }

          // Wait for room items to appear in the DOM
          await page.waitForSelector(ROOM_ITEM_SELECTOR, { timeout: 15000 }).catch(() => {});

          rooms = await page.evaluate(
            (itemSelector: string, nameSelector: string, containerSelector: string) => {
              const list = document.querySelector('[class*="room-list"]');
              const items = list ? Array.from(list.querySelectorAll('li[id]')) : [];
              return items.map((li: Element) => {
                const fullId   = (li as HTMLElement).id ?? '';
                const roomCode = fullId.split('_')[0];
                const heading  = li.querySelector(nameSelector);
                const imgCont  = li.querySelector(containerSelector);
                return {
                  roomId:       fullId,
                  roomCode,
                  roomName:     (heading?.textContent ?? '').replace(/^Room Type\s*/i, '').trim(),
                  imageMissing: imgCont?.textContent?.includes('Image coming soon') ?? false,
                };
              });
            },
            ROOM_ITEM_SELECTOR,
            ROOM_NAME_SELECTOR,
            IMAGE_CONTAINER_SELECTOR,
          );

          if (takeScreenshot && supabase) {
            try {
              const buf = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true }) as Buffer;
              const storagePath = `playwright-${scanId}/${cfg.folder}/${hotel.code}.jpg`;
              const { error: uploadErr } = await supabase.storage
                .from('scan-screenshots')
                .upload(storagePath, buf, { contentType: 'image/jpeg', upsert: true });
              if (!uploadErr) {
                const { data } = supabase.storage.from('scan-screenshots').getPublicUrl(storagePath);
                screenshotUrl = data.publicUrl;
              } else {
                console.error('[process] upload failed', hotel.code, uploadErr.message);
              }
            } catch (e: any) {
              console.error('[process] screenshot error', hotel.code, e.message);
            }
          }
        } catch (e: any) {
          errorMsg = e.message;
          chunkErrors++;
        }

        try {
          await query(
            `INSERT INTO playwright_scan_results (scan_id, hotel_id, hotel_code, occupancy, rooms, screenshot_url, error)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (scan_id, hotel_id, occupancy) DO UPDATE
               SET rooms = EXCLUDED.rooms, screenshot_url = EXCLUDED.screenshot_url, error = EXCLUDED.error, scanned_at = NOW()`,
            [scanId, hotel.id, hotel.code, cfg.folder, JSON.stringify(rooms), screenshotUrl, errorMsg],
          );
          if (!errorMsg) chunkProcessed++;
        } catch (dbErr: any) {
          console.error('[process] db write error', dbErr.message);
          chunkErrors++;
        }
      }
    } catch (e: any) {
      console.error('[process] browser launch failed for', hotel.code, e.message);
      chunkErrors += 4;
      for (const cfg of OCCUPANCY_CONFIGS) {
        await query(
          `INSERT INTO playwright_scan_results (scan_id, hotel_id, hotel_code, occupancy, rooms, error)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (scan_id, hotel_id, occupancy) DO UPDATE SET error = EXCLUDED.error, scanned_at = NOW()`,
          [scanId, hotel.id, hotel.code, cfg.folder, JSON.stringify([]), e.message],
        ).catch(() => {});
      }
    } finally {
      if (page)    await page.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
  }

  await sql`
    UPDATE playwright_scans
    SET processed = processed + ${chunkProcessed},
        errors    = errors    + ${chunkErrors}
    WHERE id = ${scanId}
  `;

  const nextOffset = offset + CHUNK_SIZE;
  const done = nextOffset >= totalHotels;

  if (done) {
    await sql`UPDATE playwright_scans SET status = 'done', finished_at = NOW() WHERE id = ${scanId}`;
  } else {
    waitUntil(
      fetch(`${appUrl}/api/playwright-scan/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId, offset: nextOffset, takeScreenshot, appUrl }),
      }).catch((e) => console.error('[process] self-call failed', e)),
    );
  }

  return NextResponse.json({ processed: chunkProcessed, errors: chunkErrors, done });
}
