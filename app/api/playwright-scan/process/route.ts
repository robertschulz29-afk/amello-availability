import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { createClient } from '@supabase/supabase-js';
import {
  OCCUPANCY_CONFIGS,
  SELECTOR_ROOM_HEADING,
  SELECTOR_IMAGE_CONTAINER,
  buildHotelSlug,
  buildUrl,
} from '@/lib/playwright-scan-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CHUNK_SIZE = 10;

// Must match the installed @sparticuz/chromium-min version
const CHROMIUM_REMOTE_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar';

let chromiumPath: string | undefined;

async function getChromiumPath(): Promise<string> {
  if (chromiumPath) return chromiumPath;
  const chromium = (await import('@sparticuz/chromium-min')).default;
  chromiumPath = await chromium.executablePath(CHROMIUM_REMOTE_URL);
  return chromiumPath;
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

interface RoomData {
  name: string;
  imageMissing: boolean;
}

export async function POST(req: NextRequest) {
  let body: { scanId?: number; offset?: number; takeScreenshot?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { scanId, offset = 0, takeScreenshot = false } = body;

  if (!scanId || !Number.isFinite(scanId) || scanId <= 0) {
    return NextResponse.json({ error: 'scanId required' }, { status: 400 });
  }

  // Load the scan row
  const scanQ = await query<{ status: string; total: number }>(
    `SELECT status, total FROM playwright_scans WHERE id = $1`,
    [scanId],
  );
  if (scanQ.rows.length === 0) {
    return NextResponse.json({ error: 'scan not found' }, { status: 404 });
  }
  const scan = scanQ.rows[0];
  if (scan.status === 'cancelled' || scan.status === 'done') {
    return NextResponse.json({ processed: 0, errors: 0, done: true });
  }

  // Load the check_in for this scan
  const checkInQ = await query<{ check_in: string }>(
    `SELECT to_char(check_in, 'YYYY-MM-DD') AS check_in FROM playwright_scans WHERE id = $1`,
    [scanId],
  );
  const checkIn = checkInQ.rows[0].check_in;

  // Load this chunk of hotels
  const hotelsQ = await query<{ id: number; name: string; code: string }>(
    `SELECT id, name, code FROM hotels WHERE active = true AND bookable = true ORDER BY id LIMIT $1 OFFSET $2`,
    [CHUNK_SIZE, offset],
  );
  const hotels = hotelsQ.rows;

  let chunkProcessed = 0;
  let chunkErrors = 0;

  for (const hotel of hotels) {
    const slug = buildHotelSlug(hotel.name, hotel.code);
    const puppeteer = (await import('puppeteer-core')).default;
    let executablePath: string;
    try {
      executablePath = await getChromiumPath();
    } catch (err: any) {
      console.error(`[playwright-process] Failed to get chromium path for hotel ${hotel.code}:`, err);
      // Write error rows for all 4 occupancies
      for (const occ of OCCUPANCY_CONFIGS) {
        await query(
          `INSERT INTO playwright_scan_results (scan_id, hotel_id, hotel_code, occupancy, error)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (scan_id, hotel_id, occupancy)
           DO UPDATE SET error = EXCLUDED.error, scanned_at = NOW()`,
          [scanId, hotel.id, hotel.code, occ.label, err.message || 'chromium path error'],
        );
      }
      chunkErrors += 4;
      continue;
    }

    const browser = await puppeteer
      .launch({
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process',
        ],
        headless: true,
      })
      .catch(async (err: Error) => {
        console.error(`[playwright-process] Browser launch failed for ${hotel.code}:`, err);
        // Write error rows for all 4 occupancies
        for (const occ of OCCUPANCY_CONFIGS) {
          await query(
            `INSERT INTO playwright_scan_results (scan_id, hotel_id, hotel_code, occupancy, error)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (scan_id, hotel_id, occupancy)
             DO UPDATE SET error = EXCLUDED.error, scanned_at = NOW()`,
            [scanId, hotel.id, hotel.code, occ.label, err.message || 'browser launch error'],
          );
        }
        chunkErrors += 4;
        return null;
      });

    if (!browser) continue;

    try {
      for (const occ of OCCUPANCY_CONFIGS) {
        const url = buildUrl(slug, checkIn, occ.param);
        let rooms: RoomData[] | null = null;
        let screenshotUrl: string | null = null;
        let errorMsg: string | null = null;

        const page = await browser.newPage().catch((e: Error) => {
          errorMsg = e.message;
          return null;
        });

        if (!page) {
          await query(
            `INSERT INTO playwright_scan_results (scan_id, hotel_id, hotel_code, occupancy, error)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (scan_id, hotel_id, occupancy)
             DO UPDATE SET error = EXCLUDED.error, scanned_at = NOW()`,
            [scanId, hotel.id, hotel.code, occ.label, errorMsg || 'failed to open page'],
          );
          chunkErrors++;
          continue;
        }

        try {
          await page.setViewport({ width: 1280, height: 900 });
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

          // Extract room data
          rooms = await page.evaluate(
            (headingSelector: string, imageContainerSelector: string): RoomData[] => {
              const headings = Array.from(document.querySelectorAll(headingSelector));
              return headings.map(el => {
                // Walk up to find the card container to check image missing status
                let container: Element | null = el;
                while (container && !container.querySelector(imageContainerSelector)) {
                  container = container.parentElement;
                }
                const imageContainer = container
                  ? container.querySelector(imageContainerSelector)
                  : null;
                const imageMissing = imageContainer
                  ? imageContainer.textContent?.includes('Image coming soon') ?? false
                  : false;
                return { name: el.textContent?.trim() ?? '', imageMissing };
              });
            },
            SELECTOR_ROOM_HEADING,
            SELECTOR_IMAGE_CONTAINER,
          );

          // Screenshot if requested
          if (takeScreenshot) {
            try {
              const screenshotBuffer = (await page.screenshot({
                type: 'jpeg',
                quality: 60,
              })) as Buffer;

              const supabase = getSupabaseClient();
              const storagePath = `playwright-${scanId}/${occ.folder}/${hotel.code}.jpg`;

              const { error: uploadError } = await supabase.storage
                .from('scan-screenshots')
                .upload(storagePath, screenshotBuffer, {
                  contentType: 'image/jpeg',
                  upsert: true,
                });

              if (uploadError) {
                console.error(`[playwright-process] Upload failed for ${hotel.code}/${occ.folder}:`, uploadError.message);
              } else {
                const { data: publicData } = supabase.storage
                  .from('scan-screenshots')
                  .getPublicUrl(storagePath);
                screenshotUrl = publicData.publicUrl;
              }
            } catch (screenshotErr: any) {
              console.error(`[playwright-process] Screenshot error for ${hotel.code}/${occ.folder}:`, screenshotErr);
            }
          }
        } catch (pageErr: any) {
          console.error(`[playwright-process] Page error for ${hotel.code}/${occ.label}:`, pageErr);
          errorMsg = pageErr.message || 'page navigation error';
        } finally {
          await page.close().catch(() => {});
        }

        // Upsert result row
        await query(
          `INSERT INTO playwright_scan_results (scan_id, hotel_id, hotel_code, occupancy, rooms, screenshot_url, error)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (scan_id, hotel_id, occupancy)
           DO UPDATE SET rooms = EXCLUDED.rooms, screenshot_url = EXCLUDED.screenshot_url, error = EXCLUDED.error, scanned_at = NOW()`,
          [
            scanId,
            hotel.id,
            hotel.code,
            occ.label,
            rooms !== null ? JSON.stringify(rooms) : null,
            screenshotUrl,
            errorMsg,
          ],
        );

        if (errorMsg) {
          chunkErrors++;
        } else {
          chunkProcessed++;
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
  }

  // Update processed/errors counts on the scan row
  await query(
    `UPDATE playwright_scans
     SET processed = processed + $1, errors = errors + $2
     WHERE id = $3`,
    [chunkProcessed, chunkErrors, scanId],
  );

  // Determine total hotels count to know if more chunks remain
  const totalHotelsQ = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM hotels WHERE active = true AND bookable = true`,
    [],
  );
  const totalHotels = parseInt(totalHotelsQ.rows[0].count, 10);
  const nextOffset = offset + CHUNK_SIZE;
  const hasMore = nextOffset < totalHotels;

  if (hasMore) {
    // Fire-and-forget: next chunk
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl) {
      fetch(`${appUrl}/api/playwright-scan/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanId, offset: nextOffset, takeScreenshot }),
      }).catch(err => {
        console.error('[playwright-process] Failed to fire next chunk:', err);
      });
    }
  } else {
    // Last chunk — mark done
    await query(
      `UPDATE playwright_scans SET status = 'done', finished_at = NOW() WHERE id = $1`,
      [scanId],
    );
  }

  return NextResponse.json({ processed: chunkProcessed, errors: chunkErrors, done: !hasMore });
}
