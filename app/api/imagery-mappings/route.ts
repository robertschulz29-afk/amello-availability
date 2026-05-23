// app/api/imagery-mappings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { sql, query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/imagery-mappings
// Optional: ?active=true|false, ?bookable=true|false
// Returns { hotels: HotelData[] }
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const active   = searchParams.get('active');
    const bookable = searchParams.get('bookable');

    const conditions: string[] = [];
    if (active === 'true')    conditions.push(`active = true`);
    if (active === 'false')   conditions.push(`active = false`);
    if (bookable === 'true')  conditions.push(`bookable = true`);
    if (bookable === 'false') conditions.push(`bookable = false`);
    const hotelWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // All hotels (optionally filtered)
    const hotelsQ = await query(
      `SELECT id, name, code FROM hotels ${hotelWhere} ORDER BY name`,
      [],
    );

    const hotelIds: number[] = hotelsQ.rows.map((h: any) => h.id);
    if (hotelIds.length === 0) return NextResponse.json({ hotels: [] });

    // All imagery mappings
    const mappingsQ = await query(
      `SELECT id, hotel_id, imagery_room_name, scan_room_name, source, confidence, updated_at
       FROM imagery_mappings
       WHERE hotel_id = ANY($1::int[])
       ORDER BY hotel_id, imagery_room_name, scan_room_name`,
      [hotelIds],
    );

    // All cr_api_rooms rows (imagery rooms + urls)
    const imageryQ = await query(
      `SELECT hotel_id, name AS room_name, image_url
       FROM cr_api_rooms
       WHERE hotel_id = ANY($1::int[])
       ORDER BY hotel_id, name`,
      [hotelIds],
    );

    // Scan rooms direct from price scan responses (same source as suggest route)
    const scanRoomsQ = await query(
      `SELECT DISTINCT sr.hotel_id, elem->>'name' AS room_name
       FROM scan_results sr,
            jsonb_array_elements(sr.response_json->'rooms') AS elem
       WHERE sr.hotel_id = ANY($1::int[])
         AND sr.source   = 'amello'
         AND sr.status   = 'green'
         AND elem->>'name' IS NOT NULL
       ORDER BY sr.hotel_id, room_name`,
      [hotelIds],
    );

    // Group by hotel_id
    const mappingsByHotel   = new Map<number, any[]>();
    const imageryByHotel    = new Map<number, { room_name: string; image_url: string }[]>();
    const scanRoomsByHotel  = new Map<number, string[]>();

    for (const row of mappingsQ.rows) {
      if (!mappingsByHotel.has(row.hotel_id)) mappingsByHotel.set(row.hotel_id, []);
      mappingsByHotel.get(row.hotel_id)!.push(row);
    }
    for (const row of imageryQ.rows) {
      if (!imageryByHotel.has(row.hotel_id)) imageryByHotel.set(row.hotel_id, []);
      imageryByHotel.get(row.hotel_id)!.push({ room_name: row.room_name, image_url: row.image_url });
    }
    for (const row of scanRoomsQ.rows) {
      if (!scanRoomsByHotel.has(row.hotel_id)) scanRoomsByHotel.set(row.hotel_id, []);
      scanRoomsByHotel.get(row.hotel_id)!.push(row.room_name);
    }

    const hotels = hotelsQ.rows
      .map((h: any) => ({
        id:           h.id,
        name:         h.name,
        code:         h.code,
        mappings:     mappingsByHotel.get(h.id)  ?? [],
        imageryRooms: imageryByHotel.get(h.id)   ?? [],
        scanRooms:    scanRoomsByHotel.get(h.id) ?? [],
      }))
      .filter((h: any) => h.imageryRooms.length > 0 || h.scanRooms.length > 0);

    return NextResponse.json({ hotels });
  } catch (e: any) {
    console.error('[GET /api/imagery-mappings]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/imagery-mappings
// Body: { hotelId, imageryRoomName, scanRoomName, source?, confidence? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { hotelId, imageryRoomName, scanRoomName, source, confidence } = body;

    if (!hotelId || !imageryRoomName || !scanRoomName) {
      return NextResponse.json(
        { error: 'hotelId, imageryRoomName and scanRoomName are required' },
        { status: 400 },
      );
    }

    const resolvedSource: string = source === 'ai' ? 'ai' : 'manual';
    const resolvedConfidence: number | null = typeof confidence === 'number' ? confidence : null;

    const result = await sql`
      INSERT INTO imagery_mappings (hotel_id, imagery_room_name, scan_room_name, source, confidence)
      VALUES (${Number(hotelId)}, ${imageryRoomName}, ${scanRoomName}, ${resolvedSource}, ${resolvedConfidence})
      ON CONFLICT (hotel_id, scan_room_name) DO UPDATE
        SET imagery_room_name = EXCLUDED.imagery_room_name,
            source            = EXCLUDED.source,
            confidence        = EXCLUDED.confidence,
            updated_at        = NOW()
      RETURNING *
    `;

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (e: any) {
    console.error('[POST /api/imagery-mappings]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/imagery-mappings?id=N
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    await sql`DELETE FROM imagery_mappings WHERE id = ${Number(id)}`;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[DELETE /api/imagery-mappings]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PATCH /api/imagery-mappings?id=N
// Body: { imageryRoomName?, scanRoomName? }
export async function PATCH(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const { imageryRoomName, scanRoomName } = body;

    if (!imageryRoomName && !scanRoomName) {
      return NextResponse.json(
        { error: 'At least one of imageryRoomName or scanRoomName is required' },
        { status: 400 },
      );
    }

    const result = await sql`
      UPDATE imagery_mappings
      SET
        imagery_room_name = COALESCE(${imageryRoomName ?? null}, imagery_room_name),
        scan_room_name    = COALESCE(${scanRoomName    ?? null}, scan_room_name),
        updated_at        = NOW()
      WHERE id = ${Number(id)}
      RETURNING *
    `;

    if (!result.rows.length) return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (e: any) {
    console.error('[PATCH /api/imagery-mappings]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
