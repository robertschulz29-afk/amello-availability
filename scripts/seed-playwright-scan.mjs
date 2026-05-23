// Seeds playwright_scans + playwright_scan_results from the reference scan_results.json.
// Run: node scripts/seed-playwright-scan.mjs
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envRaw = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8');
const envMatch = envRaw.match(/DATABASE_URL=(.+)/);
if (!envMatch) { console.error('DATABASE_URL not found in .env.local'); process.exit(1); }
const DATABASE_URL = envMatch[1].trim();

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });

const SCAN_RESULTS_PATH = 'C:/Users/ro_sc/Projects/list/scan_results.json';

// Map roomConfig labels from the reference file to occupancy folder names used in our schema
const CONFIG_MAP = {
  '1adult':         'rooms_1',
  '2adults':        'rooms_2',
  '4adults':        'rooms_4',
  '2adults_child9': 'rooms_2_child9',
};

const CHECK_IN = '2026-09-09'; // derived from the URLs in the reference data

async function main() {
  console.log('Reading', SCAN_RESULTS_PATH);
  const entries = JSON.parse(fs.readFileSync(SCAN_RESULTS_PATH, 'utf8'));
  console.log(`Loaded ${entries.length} entries`);

  // Create the playwright_scans row
  const scanRes = await pool.query(
    `INSERT INTO playwright_scans (check_in, take_screenshot, status, total, processed, errors, finished_at)
     VALUES ($1, false, 'done', $2, $3, $4, NOW())
     RETURNING id`,
    [
      CHECK_IN,
      entries.length,
      entries.filter(e => !e.error).length,
      entries.filter(e => e.error).length,
    ],
  );
  const scanId = scanRes.rows[0].id;
  console.log(`Created playwright_scans row id=${scanId}`);

  let inserted = 0;
  let skipped = 0;

  for (const entry of entries) {
    const occupancy = CONFIG_MAP[entry.roomConfig];
    if (!occupancy) {
      console.warn(`Unknown roomConfig: ${entry.roomConfig} — skipping`);
      skipped++;
      continue;
    }

    // Normalize rooms: keep only roomName + imageMissing to match our schema
    const rooms = Array.isArray(entry.rooms)
      ? entry.rooms.map(r => ({ roomName: r.roomName, imageMissing: r.imageMissing ?? false }))
      : [];

    try {
      await pool.query(
        `INSERT INTO playwright_scan_results
           (scan_id, hotel_id, hotel_code, occupancy, rooms, screenshot_url, error, scanned_at)
         VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)
         ON CONFLICT (scan_id, hotel_id, occupancy) DO NOTHING`,
        [
          scanId,
          entry.hotelId,
          entry.hotelCode,
          occupancy,
          JSON.stringify(rooms),
          entry.error ?? null,
          entry.scannedAt ?? new Date().toISOString(),
        ],
      );
      inserted++;
      if (inserted % 50 === 0) process.stdout.write(`  ${inserted}/${entries.length}\n`);
    } catch (e) {
      console.error(`  Failed ${entry.hotelCode}/${occupancy}:`, e.message);
      skipped++;
    }
  }

  console.log(`\nDone. Inserted: ${inserted}, skipped: ${skipped}`);
  console.log(`Playwright scan id: ${scanId} (check_in: ${CHECK_IN})`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
