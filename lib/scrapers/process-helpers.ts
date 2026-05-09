// lib/scrapers/process-helpers.ts
// Shared date utilities and types for scan processing sub-routes

import { sql } from '@/lib/db';

export function getBaseUrl(): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export function toYMDUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function normalizeYMD(input: any): string | null {
  if (!input && input !== 0) return null;
  if (input instanceof Date && !isNaN(input.getTime())) return toYMDUTC(input);
  const s = String(input);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return toYMDUTC(d);
  return null;
}

export function ymdToUTC(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function datesFromBase(baseYMD: string, days: number): string[] {
  const base = ymdToUTC(baseYMD);
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const dt = new Date(base);
    dt.setUTCDate(dt.getUTCDate() + i);
    out.push(toYMDUTC(dt));
  }
  return out;
}

export type ScanCell = {
  hotelId: number;
  hotelCode: string;
  bookingUrl: string | null;
  checkIn: string;
  checkOut: string;
};

export async function markJobDone(jobId: number, scanId: number) {
  await sql`UPDATE scan_source_jobs SET status = 'done', updated_at = NOW() WHERE id = ${jobId}`;
  await checkAndFinalizeScan(scanId);
}

export async function checkAndFinalizeScan(scanId: number) {
  const pending = await sql`
    SELECT COUNT(*)::int AS c FROM scan_source_jobs
    WHERE scan_id = ${scanId} AND status IN ('running','queued')
  `;
  if ((pending.rows[0]?.c ?? 1) === 0) {
    await sql`UPDATE scans SET status = 'done' WHERE id = ${scanId} AND status != 'cancelled'`;
    console.log(`[scan] Scan #${scanId} finalized — all source jobs complete`);

    await sql`
      INSERT INTO hotel_room_names (hotel_id, source, room_name, last_seen_at)
      SELECT DISTINCT sr.hotel_id, sr.source, elem->>'name', NOW()
      FROM scan_results sr,
           jsonb_array_elements(sr.response_json->'rooms') AS elem
      WHERE sr.scan_id = ${scanId}
        AND sr.status  = 'green'
        AND elem->>'name' IS NOT NULL
      ON CONFLICT (hotel_id, source, room_name)
        DO UPDATE SET last_seen_at = NOW()
    `;
  }
}
