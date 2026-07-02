// app/api/room-imagery/report/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/room-imagery/report
// Optional: ?active=true|false, ?bookable=true|false, ?missingOnly=true
// Returns [{ hotel_id, hotel_name, active, bookable, scan_room_name, imagery_room_name, image_url }]
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const active      = searchParams.get('active');
    const bookable    = searchParams.get('bookable');
    const missingOnly = searchParams.get('missingOnly');

    const hotelConditions: string[] = [];
    if (active === 'true')    hotelConditions.push(`h.active = true`);
    if (active === 'false')   hotelConditions.push(`h.active = false`);
    if (bookable === 'true')  hotelConditions.push(`h.bookable = true`);
    if (bookable === 'false') hotelConditions.push(`h.bookable = false`);
    const hotelWhere = hotelConditions.length ? `AND ${hotelConditions.join(' AND ')}` : '';
    const missingFilter = missingOnly === 'true' ? `AND ri.image_url IS NULL` : '';

    const result = await query(
      `SELECT
         h.id   AS hotel_id,
         h.name AS hotel_name,
         h.active,
         h.bookable,
         sr_rooms.room_name AS scan_room_name,
         im.imagery_room_name,
         ri.image_url
       FROM (
         SELECT DISTINCT sr.hotel_id, elem->>'name' AS room_name
         FROM scan_results sr,
              jsonb_array_elements(sr.response_json->'rooms') AS elem
         WHERE sr.source = 'amello'
           AND sr.status = 'green'
           AND elem->>'name' IS NOT NULL
       ) sr_rooms
       JOIN hotels h ON h.id = sr_rooms.hotel_id
       LEFT JOIN imagery_mappings im
         ON im.hotel_id = sr_rooms.hotel_id AND im.scan_room_name = sr_rooms.room_name
       LEFT JOIN cr_api_rooms ri
         ON ri.hotel_id = im.hotel_id AND ri.name = im.imagery_room_name
       WHERE 1=1 ${hotelWhere} ${missingFilter}
       ORDER BY h.name, sr_rooms.room_name`,
      [],
    );

    return NextResponse.json(result.rows);
  } catch (e: any) {
    console.error('[GET /api/room-imagery/report]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
