import { rmSync } from 'fs';
import { query, sql } from '@/lib/db';
import { createClient } from '@supabase/supabase-js';
import {
  OCCUPANCY_CONFIGS, ROOM_CARD_SELECTOR, ROOM_NAME_SELECTOR, IMAGE_CONTAINER_SELECTOR,
  buildHotelSlug, buildTuiUrl,
} from '@/lib/playwright-scan-helpers';

const CHUNK_SIZE = 3;

const CHROMIUM_URL = 'https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar';

async function getChromiumPath(): Promise<string> {
  const chromium = (await import('@sparticuz/chromium-min')).default;
  return chromium.executablePath(CHROMIUM_URL);
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export type RunChunkResult = { processed: number; errors: number; done: boolean; skipped?: boolean; reason?: string; error?: string; aborted?: boolean };

export async function runChunk({ scanId, offset, takeScreenshot }: {
  scanId: number; offset: number; takeScreenshot: boolean;
}): Promise<RunChunkResult> {

  const scanQ = await sql`SELECT status, check_in FROM playwright_scans WHERE id = ${scanId}`;
  if (!scanQ.rows.length) return { processed: 0, errors: 0, done: false, error: 'scan not found' };
  const scan = scanQ.rows[0];
  if (scan.status !== 'running') {
    return { processed: 0, errors: 0, done: false, skipped: true, reason: scan.status };
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
  let aborted        = false;

  const executablePath = await getChromiumPath();
  const { chromium } = await import('playwright-core');
  const supabase = takeScreenshot ? getSupabaseClient() : null;

  const LAUNCH_ARGS = [
    '--no-sandbox', '--disable-setuid-sandbox', '--no-zygote',
    '--disable-dev-shm-usage', '--disable-gpu',
    '--disk-cache-size=0', '--media-cache-size=0', '--disable-application-cache',
  ];

  async function scrapeHotel(hotel: { id: number; name: string; code: string }): Promise<{ processed: number; errors: number; aborted: boolean }> {
    const slug = buildHotelSlug(hotel.name, hotel.code);
    let hotelProcessed = 0;
    let hotelErrors = 0;
    let hotelAborted = false;
    let context: any = null;
    const userDataDir = `/tmp/chrome-${hotel.code}-${Date.now()}`;

    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        executablePath,
        args: LAUNCH_ARGS,
        headless: true,
      });

      // Process all 4 occupancies in parallel, each on its own page
      await Promise.all(OCCUPANCY_CONFIGS.map(async cfg => {
        const url = buildTuiUrl(slug, checkIn, cfg.param);
        let rooms: Array<{ roomId: string; roomCode: string; roomName: string; imageMissing: boolean }> = [];
        let screenshotUrl: string | null = null;
        let errorMsg: string | null = null;
        let page: any = null;

        try {
          page = await context.newPage();
          await page.setViewportSize({ width: 1440, height: 900 });

          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          } catch {
            // partial load — still attempt extraction
          }

          await page.waitForSelector(ROOM_CARD_SELECTOR, { timeout: 15000 }).catch(() => {});
          await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

          rooms = await page.evaluate(
            ({ cardSelector, nameSelector, containerSelector }: { cardSelector: string; nameSelector: string; containerSelector: string }) => {
              const cards = Array.from(document.querySelectorAll(cardSelector));
              return cards.map((card: Element) => {
                const fullId   = (card as HTMLElement).id ?? '';
                const roomCode = fullId.split('_')[0];
                const heading  = card.querySelector(nameSelector);
                const imgCont  = card.querySelector(containerSelector);
                return {
                  roomId:       fullId,
                  roomCode,
                  roomName:     (heading?.textContent ?? '').replace(/^Room Type\s*/i, '').trim(),
                  imageMissing: imgCont?.textContent?.includes('Image coming soon') ?? false,
                };
              });
            },
            { cardSelector: ROOM_CARD_SELECTOR, nameSelector: ROOM_NAME_SELECTOR, containerSelector: IMAGE_CONTAINER_SELECTOR },
          );

          if (takeScreenshot && supabase) {
            try {
              const buf = Buffer.from(await page.screenshot({ type: 'jpeg', quality: 60, fullPage: true }));
              const storagePath = `playwright-${scanId}/${cfg.folder}/${hotel.code}.jpg`;
              const { error: uploadErr } = await supabase.storage
                .from('scan-screenshots')
                .upload(storagePath, buf, { contentType: 'image/jpeg', upsert: true });
              if (!uploadErr) {
                const { data } = supabase.storage.from('scan-screenshots').getPublicUrl(storagePath);
                screenshotUrl = data.publicUrl;
              } else {
                console.error('[playwright-runner] upload failed', hotel.code, uploadErr.message);
              }
            } catch (e: any) {
              console.error('[playwright-runner] screenshot error', hotel.code, e.message);
            }
          }
        } catch (e: any) {
          errorMsg = e.message;
          hotelErrors++;
        } finally {
          if (page) await page.close().catch(() => {});
        }

        try {
          await query(
            `INSERT INTO playwright_scan_results (scan_id, hotel_id, hotel_code, occupancy, rooms, screenshot_url, error)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (scan_id, hotel_id, occupancy) DO UPDATE
               SET rooms = EXCLUDED.rooms, screenshot_url = EXCLUDED.screenshot_url, error = EXCLUDED.error, scanned_at = NOW()`,
            [scanId, hotel.id, hotel.code, cfg.folder, JSON.stringify(rooms), screenshotUrl, errorMsg],
          );
          if (!errorMsg) hotelProcessed++;
        } catch (dbErr: any) {
          if (dbErr.message?.includes('foreign key constraint')) {
            console.warn('[playwright-runner] scan deleted mid-run, aborting', scanId);
            hotelAborted = true;
          } else {
            console.error('[playwright-runner] db write error', dbErr.message);
            hotelErrors++;
          }
        }
      }));
    } catch (e: any) {
      console.error('[playwright-runner] scrape failed for', hotel.code, e.message);
      hotelErrors += OCCUPANCY_CONFIGS.length;
      for (const cfg of OCCUPANCY_CONFIGS) {
        await query(
          `INSERT INTO playwright_scan_results (scan_id, hotel_id, hotel_code, occupancy, rooms, error)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (scan_id, hotel_id, occupancy) DO UPDATE SET error = EXCLUDED.error, scanned_at = NOW()`,
          [scanId, hotel.id, hotel.code, cfg.folder, JSON.stringify([]), e.message],
        ).catch(() => {});
      }
    } finally {
      await context?.close().catch(() => {});
      try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    }

    return { processed: hotelProcessed, errors: hotelErrors, aborted: hotelAborted };
  }

  for (const hotel of hotels) {
    const result = await scrapeHotel(hotel);
    chunkProcessed += result.processed;
    chunkErrors    += result.errors;
    if (result.aborted) return { processed: chunkProcessed, errors: chunkErrors, done: false, aborted: true };
  }

  await sql`
    UPDATE playwright_scans
    SET processed = processed + ${chunkProcessed},
        errors    = errors    + ${chunkErrors}
    WHERE id = ${scanId}
  `;

  const done = (offset + CHUNK_SIZE) >= totalHotels;
  if (done) {
    await sql`UPDATE playwright_scans SET status = 'done', finished_at = NOW() WHERE id = ${scanId}`;
  }

  return { processed: chunkProcessed, errors: chunkErrors, done };
}
