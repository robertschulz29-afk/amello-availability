import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const scanQ = await sql`SELECT id, scanned_at, fixed_checkout, start_offset, end_offset, timezone FROM scans WHERE id = ${id}`;
  if (scanQ.rowCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const scan = scanQ.rows[0] as any;

  const hotels = (await sql`SELECT id, name, code FROM hotels ORDER BY id ASC`).rows as Array<{ id:number; name:string; code:string }>;
  const byId = new Map(hotels.map(h => [h.id, h]));

  const resQ = await sql`SELECT hotel_id, check_in_date, status FROM scan_results WHERE scan_id = ${id}`;

  const results: Record<string, Record<string, 'green'|'red'>> = {};
  const datesSet = new Set<string>();
  for (const row of resQ.rows as Array<{ hotel_id:number; check_in_date: string; status:'green'|'red' }>) {
    const hotel = byId.get(row.hotel_id);
    if (!hotel) continue;
    results[hotel.code] = results[hotel.code] || {};
    const d = row.check_in_date instanceof Date ? row.check_in_date.toISOString().slice(0,10) : String(row.check_in_date);
    datesSet.add(d);
    results[hotel.code][d] = row.status;
  }
  const dates = Array.from(datesSet).sort();

  return NextResponse.json({ scanId: scan.id, dates, results, scannedAt: scan.scanned_at, fixedCheckout: scan.fixed_checkout });
}
