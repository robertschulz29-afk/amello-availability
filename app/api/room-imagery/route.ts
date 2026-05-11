// app/api/room-imagery/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/room-imagery
// Optional: ?hotelId=N, ?active=true, ?bookable=true
// Returns [{ id, hotel_id, hotel_name, hotel_code, room_name, image_url, updated_at }]
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hotelId  = searchParams.get('hotelId');
    const active   = searchParams.get('active');
    const bookable = searchParams.get('bookable');

    const conditions: string[] = [];
    const params: any[]        = [];
    let p = 1;

    if (hotelId) {
      conditions.push(`ri.hotel_id = $${p++}`);
      params.push(Number(hotelId));
    }
    if (active === 'true') {
      conditions.push(`h.active = true`);
    }
    if (bookable === 'true') {
      conditions.push(`h.bookable = true`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT ri.id, ri.hotel_id, h.name AS hotel_name, h.code AS hotel_code,
              ri.room_name, ri.image_url, ri.updated_at
       FROM room_imagery ri
       JOIN hotels h ON h.id = ri.hotel_id
       ${where}
       ORDER BY h.name, ri.room_name`,
      params,
    );

    return NextResponse.json(result.rows);
  } catch (e: any) {
    console.error('[GET /api/room-imagery]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
