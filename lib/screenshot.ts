// lib/screenshot.ts
import { createClient } from '@supabase/supabase-js';
import { query } from '@/lib/db';

// Cached after first resolution — chromium-min download is slow
let chromiumPath: string | undefined;

// Must match the installed @sparticuz/chromium-min version. Vercel runs x64.
const CHROMIUM_REMOTE_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar';

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
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables',
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export interface ScreenshotParams {
  hotelCode: string;
  hotelId: number;
  scanId: number;
  checkInDate: string;   // YYYY-MM-DD
  checkOutDate: string;  // YYYY-MM-DD
}

/**
 * Captures a full-page JPEG screenshot of the hotel's TUI Amello page,
 * uploads it to Supabase Storage, upserts a `scan_screenshots` row, and
 * returns the public URL.
 *
 * Throws on any unrecoverable error — callers should catch and continue.
 */
export async function captureAndStoreScreenshot({
  hotelCode,
  hotelId,
  scanId,
  checkInDate,
  checkOutDate,
}: ScreenshotParams): Promise<string> {
  const targetUrl =
    `https://www.tuiamello.com/en-DE/hotel/${hotelCode}/` +
    `?departure-date=${checkInDate}&return-date=${checkOutDate}&rooms=1`;

  console.log(`[screenshot] Capturing ${hotelCode} (scan ${scanId}): ${targetUrl}`);

  const puppeteer = (await import('puppeteer-core')).default;
  const executablePath = await getChromiumPath();

  const browser = await puppeteer.launch({
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
    ],
    headless: true,
  });

  let screenshotBuffer: Buffer;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 50_000,
    });

    screenshotBuffer = (await page.screenshot({
      type: 'jpeg',
      quality: 60,
      fullPage: true,
    })) as Buffer;
  } finally {
    await browser.close();
  }

  // Upload to Supabase Storage
  const supabase = getSupabaseClient();
  const storagePath = `scan-${scanId}/${hotelCode}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from('scan-screenshots')
    .upload(storagePath, screenshotBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Supabase upload failed for ${hotelCode}: ${uploadError.message}`);
  }

  const { data: publicData } = supabase.storage
    .from('scan-screenshots')
    .getPublicUrl(storagePath);

  const publicUrl = publicData.publicUrl;

  // Upsert DB row
  await query(
    `INSERT INTO scan_screenshots (scan_id, hotel_id, hotel_code, screenshot_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (scan_id, hotel_id)
     DO UPDATE SET screenshot_url = EXCLUDED.screenshot_url, captured_at = NOW()`,
    [scanId, hotelId, hotelCode, publicUrl],
  );

  console.log(`[screenshot] Stored ${hotelCode}: ${publicUrl}`);
  return publicUrl;
}
