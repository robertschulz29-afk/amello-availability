import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const scanId = Number(params.id);
  if (!Number.isFinite(scanId) || scanId <= 0) {
    return NextResponse.json({ error: 'invalid scan id' }, { status: 400 });
  }

  try {
    const { rows } = await query(
      `SELECT hotel_id AS id, name, code, brand, region, country, bookable, active
       FROM scan_hotels
       WHERE scan_id = $1
       ORDER BY name`,
      [scanId],
    );

    const total    = rows.length;
    const bookable = rows.filter(r => r.bookable).length;
    const active   = rows.filter(r => r.active).length;

    return NextResponse.json({ hotels: rows, total, bookable, active });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
