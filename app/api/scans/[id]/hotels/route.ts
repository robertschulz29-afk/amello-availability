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
      `SELECT sh.hotel_id AS id, COALESCE(h.name, 'Hotel ' || sh.hotel_id) AS name,
              sh.code, h.brand, h.region, h.country, sh.bookable, sh.active
       FROM scan_hotels sh
       LEFT JOIN hotels h ON h.id = sh.hotel_id
       WHERE sh.scan_id = $1 AND sh.bookable = true AND sh.active = true
       ORDER BY name`,
      [scanId],
    );

    return NextResponse.json({ hotels: rows, total: rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
