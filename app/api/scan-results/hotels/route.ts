import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Returns the distinct hotels that have results for a given scan, ordered by name.
// Used by the price comparison page to paginate at the hotel level before fetching row data.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const scanIDParam = searchParams.get('scanID');
    const hotelIDParam = searchParams.get('hotelID');

    if (!scanIDParam) return NextResponse.json({ error: 'scanID required' }, { status: 400 });
    const scanID = parseInt(scanIDParam, 10);

    const conditions: string[] = ['sr.scan_id = $1'];
    const params: (number | string)[] = [scanID];

    const hotelIDs = hotelIDParam
      ? hotelIDParam.split(',').map(s => parseInt(s.trim(), 10)).filter(n => isFinite(n))
      : [];

    if (hotelIDs.length === 1) {
      conditions.push(`sr.hotel_id = $2`);
      params.push(hotelIDs[0]);
    } else if (hotelIDs.length > 1) {
      const placeholders = hotelIDs.map((_, i) => `$${i + 2}`).join(', ');
      conditions.push(`sr.hotel_id IN (${placeholders})`);
      params.push(...hotelIDs);
    }

    const { rows } = await query(
      `SELECT DISTINCT sr.hotel_id, COALESCE(h.name, 'Hotel ' || sr.hotel_id) AS hotel_name
       FROM scan_results sr
       LEFT JOIN hotels h ON h.id = sr.hotel_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY hotel_name`,
      params,
    );

    return NextResponse.json(rows);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
