// app/api/room-imagery/report/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/room-imagery/report
// Optional: ?active=true, ?bookable=true, ?missingOnly=true
// Returns [{ hotel_id, hotel_name, active, bookable, scan_room_name, imagery_room_name, image_url }]
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const active      = searchParams.get('active');
    const bookable    = searchParams.get('bookable');
    const missingOnly = searchParams.get('missingOnly');

    const conditions: string[] = [`hrn.source = 'amello'`];

    if (active === 'true')      conditions.push(`h.active = true`);
    if (bookable === 'true')    conditions.push(`h.bookable = true`);
    if (missingOnly === 'true') conditions.push(`ri.image_url IS NULL`);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT
         h.id   AS hotel_id,
         h.name AS hotel_name,
         h.active,
         h.bookable,
         hrn.room_name   AS scan_room_name,
         im.imagery_room_name,
         ri.image_url
       FROM hotel_room_names hrn
       JOIN hotels h ON h.id = hrn.hotel_id
       LEFT JOIN imagery_mappings im
         ON im.hotel_id = hrn.hotel_id AND im.scan_room_name = hrn.room_name
       LEFT JOIN room_imagery ri
         ON ri.hotel_id = im.hotel_id AND ri.room_name = im.imagery_room_name
       ${where}
       ORDER BY h.name, hrn.room_name`,
      [],
    );

    return NextResponse.json(result.rows);
  } catch (e: any) {
    console.error('[GET /api/room-imagery/report]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
